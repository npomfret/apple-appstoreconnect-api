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
//
// Each leg owns its directory, by name rather than the VCS-settings hash the two would otherwise
// share. It is emptied before checkout, so ignored leftovers such as a stale out-tsc/junit.xml
// cannot reach a build, and set to be removed once the build ends. Nothing here is a cache:
// node_modules comes from `npm ci` on every run, and test results reach TeamCity during the build.
fun BuildType.checkoutAndToolchain(workspace: String) {
    vcs {
        root(DslContext.settingsRoot)
        checkoutDir = workspace
        cleanCheckout = true
    }
    params {
        param("system.teamcity.build.checkoutDir.expireHours", "0")
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
    checkoutAndToolchain("appstoreconnect-bot-checks")
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
    checkoutAndToolchain("appstoreconnect-bot-tests")
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

// TEMPORARY, removed once the evidence is recorded, and not before ProbeBuildCleanup run 4, which
// is what shows the timed-out run 3 was cleaned. Each run confirms the exact revision, checks every
// seed by path, because a clean `git status` cannot see inside .git, then seeds the workspace again.
// The .git seed is what separates emptying the directory from `git clean` and a reset. Pinned to
// one agent, or a later run could land on an agent that never saw the seed and prove nothing.
//   ProbeControl: nothing cleans, so every seed must survive. Without this the other two could pass
//   only because nothing was ever left to find.
//   ProbeCleanCheckout: only the emptying before checkout acts, so a survivor shows it failed.
//   ProbeBuildCleanup: only the removal after a build acts, so a survivor shows it failed. Run 2
//   fails on purpose and run 3 is stopped by the execution timeout. The sentinel each publishes
//   shows whether a build's evidence leaves before the directory goes.
fun workspaceProbe(
    probeId: String,
    probeName: String,
    clean: Boolean,
    expireHours: String,
    seedSurvives: Boolean,
    endsBadly: Boolean,
) = BuildType {
    id(probeId)
    name = probeName
    maxRunningBuilds = 1
    artifactRules = "probe-sentinel.txt => evidence"
    vcs {
        root(DslContext.settingsRoot)
        checkoutDir = "appstoreconnect-bot-" + probeId.lowercase()
        cleanCheckout = clean
    }
    params {
        param("system.teamcity.build.checkoutDir.expireHours", expireHours)
    }
    requirements {
        equals("teamcity.agent.name", "macstudio-1")
    }
    val ending = if (endsBadly) {
        "case %build.counter% in " +
            "2) echo 'PROBE controlled failure'; exit 1 ;; " +
            "3) echo 'PROBE waiting for the execution timeout'; sleep 150 ;; " +
            "esac"
    } else {
        ""
    }
    steps {
        script {
            name = "probe"
            scriptContent = """
                set -eu
                echo "PROBE run=%build.counter% agent=%teamcity.agent.name%"
                test "$(git rev-parse HEAD)" = "%build.vcs.number%"
                echo "PROBE exact revision %build.vcs.number%"
                echo "PROBE workspaces: $(ls -d ../appstoreconnect-bot-* | tr '\n' ' ')"
                wrong=0
                for f in .git/probe-sentinel probe-sentinel.txt out-tsc/junit.xml dist/stale.js node_modules/.stale tmp/stale.log; do
                    if [ -e "${'$'}f" ]; then found=yes; else found=no; fi
                    echo "PROBE ${'$'}f found=${'$'}found"
                    if [ %build.counter% -gt 1 ] && [ "$seedSurvives" = "true" ]; then
                        if [ "${'$'}found" = "no" ]; then wrong=1; fi
                    elif [ "${'$'}found" = "yes" ]; then
                        wrong=1
                    fi
                done
                if [ "${'$'}wrong" = "1" ]; then echo "PROBE UNEXPECTED"; exit 3; fi
                echo "PROBE as expected"
                mkdir -p out-tsc dist node_modules tmp
                echo stale > .git/probe-sentinel
                echo stale > probe-sentinel.txt
                echo '<testsuites/>' > out-tsc/junit.xml
                echo stale > dist/stale.js
                echo stale > node_modules/.stale
                echo stale > tmp/stale.log
                echo "PROBE seeded"
                $ending
            """.trimIndent()
        }
    }
    triggers {
        schedule {
            schedulingPolicy = cron {
                seconds = "0"
                minutes = "*/4"
                hours = "*"
                dayOfMonth = "*"
                month = "*"
                dayOfWeek = "?"
            }
            branchFilter = "+:<default>"
            triggerBuild = always()
            withPendingChangesOnly = false
        }
    }
    failureConditions {
        executionTimeoutMin = 1
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
    buildType(workspaceProbe("ProbeControl", "Probe: control", false, "1", true, false))
    buildType(workspaceProbe("ProbeCleanCheckout", "Probe: clean checkout", true, "1", false, false))
    buildType(workspaceProbe("ProbeBuildCleanup", "Probe: build cleanup", false, "0", false, true))
}
