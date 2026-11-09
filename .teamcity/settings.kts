import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.schedule
import jetbrains.buildServer.configs.kotlin.triggers.vcs

version = "2026.1"

// Both rules are needed: `-:**/*.md` matches only files inside a directory, so without
// `-:*.md` a README-only commit still starts a full build. TEAMCITY-AGENTS.md section 8.
val onlyWhatCanChangeABuild = """
    +:**
    -:docs/**
    -:**/*.md
    -:*.md
""".trimIndent()

// Every step's full console goes to a file in the build temp dir as well as the build log, so a
// failure can be read as one download. The temp dir is new for each build, so nothing stale from
// an earlier run can be published. `tee` alone would hide the command's exit status from sh,
// which has no portable pipefail, so the status travels through a file.
val evidence = "%system.teamcity.build.tempDir%/evidence"

fun BuildSteps.logged(stepName: String, command: String) {
    script {
        name = stepName
        scriptContent = """
            mkdir -p "$evidence/logs"
            { $command; echo $? > "$evidence/$stepName.rc"; } 2>&1 | tee "$evidence/logs/$stepName.log"
            exit "$(cat "$evidence/$stepName.rc")"
        """.trimIndent()
    }
}

// No agent requirement, per section 8: the three agents are one Mac and report no capability
// meaning "has Node 22", and a build no agent accepts sits in the queue looking like an
// outage. The toolchain is asserted in the first step instead, where it fails in seconds and
// names what is missing.
//
// Each leg owns its directory, by name rather than the VCS-settings hash the two would otherwise
// share. It is emptied before checkout, so ignored leftovers such as a stale out-tsc/junit.xml
// cannot reach a build, and removed once the build ends, however it ends. Nothing here is a cache:
// node_modules comes from `npm ci` on every run, and test results reach TeamCity during the build.
fun BuildType.checkoutAndToolchain(workspace: String) {
    vcs {
        root(DslContext.settingsRoot)
        checkoutDir = workspace
        cleanCheckout = true
    }
    params {
        param("system.teamcity.build.checkoutDir.expireHours", "0")
        // npm writes its debug log here instead of ~/.npm/_logs, where it would outlive the build
        // on a shared Mac and never reach TeamCity.
        param("env.npm_config_logs_dir", "$evidence/npm-logs")
    }
    // Paths outside the checkout, so no build can publish what an earlier one left behind.
    artifactRules = """
        $evidence/logs => logs
        $evidence/npm-logs => logs/npm
    """.trimIndent()
    steps {
        script {
            name = "toolchain"
            scriptContent = """
                set -eu
                command -v node >/dev/null 2>&1 || { echo "this agent has no node on PATH"; exit 1; }
                node -e 'const v = process.versions.node; if (+v.split(".")[0] < 22) { console.error("package.json engines wants Node >=22; this agent has " + v); process.exit(1); }'
                node --version
                npm --version
            """.trimIndent()
        }
        // `npm ci`, not `npm install`: the lockfile is the pinned input, and ci fails on a
        // disagreement with package.json rather than quietly rewriting it.
        logged("install", "npm ci")
    }
}

val checks = BuildType {
    id("Checks")
    name = "Checks"
    description = "Type check and compile. Runs no suite, so it can finish beside Tests on an " +
        "agent that would otherwise idle."
    checkoutAndToolchain("appstoreconnect-bot-checks")
    steps {
        logged("checks", "npm run verify:checks")
    }
    failureConditions {
        executionTimeoutMin = 10
    }
}

val tests = BuildType {
    id("Tests")
    name = "Tests"
    description = "The unit suite and nothing else, so per-test history hangs off a build that " +
        "does not also type check."
    checkoutAndToolchain("appstoreconnect-bot-tests")
    // The checkout is emptied before every build, so this junit.xml can only be this run's.
    artifactRules += "\nout-tsc/junit.xml => test-results"
    steps {
        logged("tests", "npm run verify:tests")
    }
    features {
        // Generic rather than the typed builder, following super-funmax-music: a wrong parameter
        // finds no reports and says so, where a wrong symbol stops this script compiling.
        feature {
            type = "xml-report-plugin"
            param("xmlReportParsing.reportType", "junit")
            param("xmlReportParsing.reportDirs", "+:out-tsc/junit.xml")
            // Left on deliberately: it distinguishes "no reports" from "a report it could not
            // use", and the suite count it prints is the only thing that proves this works.
            param("xmlReportParsing.verboseOutput", "true")
        }
    }
    failureConditions {
        executionTimeoutMin = 10
    }
}

// A composite never checks out, so the clean-workspace rule has nothing to apply to here. The
// root below only lets it show the changes its legs built.
val verify = BuildType {
    id("Verify")
    name = "Verify"
    description = "Runs nothing. One answer to \"did this commit pass\", so nobody reads two " +
        "configurations to find out."
    type = BuildTypeSettings.Type.COMPOSITE
    vcs {
        root(DslContext.settingsRoot)
        showDependenciesChanges = true
    }
    dependencies {
        snapshot(checks) { onDependencyFailure = FailureAction.ADD_PROBLEM }
        snapshot(tests) { onDependencyFailure = FailureAction.ADD_PROBLEM }
    }
    // Both triggers hang on the composite: it pulls its dependencies in, so this is one trigger
    // and one place to edit.
    triggers {
        vcs {
            branchFilter = "+:<default>"
            triggerRules = onlyWhatCanChangeABuild
            perCheckinTriggering = true
        }
        // 02:00, an hour no other project uses -- 00:00, 03:30, 03:45 and 04:00 are taken, and
        // there are only three agents. A green build proves the code passed against that day's
        // world only: nothing here is vendored, so `npm ci` reaches the registry on every run,
        // and the toolchain is whatever is installed on a Mac three projects share.
        schedule {
            schedulingPolicy = daily {
                hour = 2
            }
            branchFilter = "+:<default>"
            // The point is to build an unchanged repo, so this must not wait for a change.
            triggerBuild = always()
            withPendingChangesOnly = false
            // Without these the nightly reports on yesterday's legs instead of running today's:
            // the dependencies above reuse a successful build at the same revision, and on an
            // unchanged repo that is always the last one. Every leg already starts empty, so this
            // only stops the reuse.
            enforceCleanCheckout = true
            enforceCleanCheckoutForDependencies = true
        }
    }
}

project {
    description = "Unofficial App Store Connect client. The suite replaces fetch and reads no " +
        "capture, so CI needs Node and the npm registry and nothing else."

    // The server-wide default keeps everything forever on a disk shared with the public sites.
    // A week of artifacts (logs and the JUnit report) leaves time to read a failure.
    cleanup {
        baseRule {
            artifacts(days = 7)
            history(days = 30)
        }
    }

    buildType(checks)
    buildType(tests)
    buildType(verify)
}
