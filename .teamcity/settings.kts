import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.vcs

version = "2026.1"

// Exclusions rather than an allowlist: a new source directory should build without anyone
// remembering to widen this, and the only things here that cannot change a result are prose.
val onlyWhatCanChangeABuild = """
    +:**
    -:docs/**
    -:**.md
""".trimIndent()

val build = BuildType {
    id("Build")
    name = "Build"
    description = "Type check, unit suite, and compile. One configuration rather than a chain: " +
        "the whole thing is seconds, and three agents are shared estate-wide, so splitting it " +
        "would spend more time queueing than running."

    vcs {
        root(DslContext.settingsRoot)
    }

    // No agent requirement. All three agents are the same Mac, so a requirement selects nothing a
    // free agent would not already satisfy, and a wrong capability name fails as "no compatible
    // agent" -- which reads as a server problem -- where a missing toolchain fails on the agent
    // naming the command it could not find.
    steps {
        script {
            name = "install"
            // `npm ci` not `npm install`: the lockfile is the pinned input, and ci fails rather
            // than quietly rewriting it when package.json and the lock disagree.
            scriptContent = "npm ci"
        }
        script {
            name = "typecheck"
            scriptContent = "npm run typecheck"
        }
        script {
            // Runs the test tsconfig itself, so it type checks `test/` as well -- not redundant
            // with the step above, which covers `src/` only.
            name = "test"
            scriptContent = "npm test"
        }
        script {
            name = "build"
            scriptContent = "npm run build"
        }
    }

    failureConditions {
        executionTimeoutMin = 10
    }

    triggers {
        vcs {
            branchFilter = "+:<default>"
            triggerRules = onlyWhatCanChangeABuild
            perCheckinTriggering = true
        }
    }
}

project {
    description = "Unofficial App Store Connect client. No network in the suite, so CI needs " +
        "nothing but Node and the npm registry."

    // The server-wide default keeps everything forever. This build publishes no artifacts, so
    // there is only history to bound.
    cleanup {
        baseRule {
            history(days = 30)
        }
    }

    buildType(build)
}
