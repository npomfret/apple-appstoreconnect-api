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

// No agent requirement, per section 8: the three agents are one Mac and report no capability
// meaning "has Node 22", and a build no agent accepts sits in the queue looking like an
// outage. The toolchain is asserted in the first step instead, where it fails in seconds and
// names what is missing.
fun BuildType.checkoutAndToolchain() {
    vcs {
        root(DslContext.settingsRoot)
    }
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
        script {
            name = "install"
            // `npm ci`, not `npm install`: the lockfile is the pinned input, and ci fails on a
            // disagreement with package.json rather than quietly rewriting it.
            scriptContent = "npm ci"
        }
    }
}

val checks = BuildType {
    id("Checks")
    name = "Checks"
    description = "Type check and compile. Runs no suite, so it can finish beside Tests on an " +
        "agent that would otherwise idle."
    checkoutAndToolchain()
    steps {
        script {
            name = "checks"
            scriptContent = "npm run verify:checks"
        }
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
    checkoutAndToolchain()
    steps {
        script {
            name = "tests"
            scriptContent = "npm run verify:tests"
        }
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
            // The one run that starts from an empty directory, so green means a fresh clone
            // builds rather than that an incremental working copy still does.
            enforceCleanCheckout = true
            enforceCleanCheckoutForDependencies = true
        }
    }
}

project {
    description = "Unofficial App Store Connect client. The suite replaces fetch and reads no " +
        "capture, so CI needs Node and the npm registry and nothing else."

    // The server-wide default keeps everything forever. Nothing here publishes artifacts, so
    // there is only history to bound.
    cleanup {
        baseRule {
            history(days = 30)
        }
    }

    buildType(checks)
    buildType(tests)
    buildType(verify)
}
