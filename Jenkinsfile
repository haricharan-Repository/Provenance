// Stage 8. The image tag must equal @playwright/test in package.json; `tl doctor` enforces it.
pipeline {
  agent {
    docker {
      image 'mcr.microsoft.com/playwright:v1.64.1-noble'
      args '-u root --ipc=host -v truthline-npm-cache:/npm-cache'
    }
  }

  parameters {
    choice(name: 'ENV', choices: ['demo', 'staging'], description: 'Target environment. Anything but demo needs the BASE_URL_<ENV> Jenkins variable.')
    string(name: 'TAGS', defaultValue: '', description: 'Optional grep. Overrides RUN_MODE selection, for example @REQ-142|@smoke')
    string(name: 'SHARDS', defaultValue: '4', description: 'Number of parallel shards')
    choice(name: 'RUN_MODE', choices: ['smart', 'full', 'smoke'], description: 'smart runs affected REQs + @risk-high + @smoke')
  }

  options {
    timeout(time: 60, unit: 'MINUTES')
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  environment {
    CI = 'true'
    HOME = '/root' // Firefox refuses to start as root otherwise.
    NPM_CONFIG_CACHE = '/npm-cache'
    TEST_USER = credentials('truthline-test-user')
  }

  stages {
    stage('Install') {
      steps {
        sh 'git config --global --add safe.directory "$WORKSPACE"'
        sh 'npm ci --prefer-offline'
      }
    }

    stage('Preflight') {
      steps {
        sh 'npm run --silent tl -- doctor'
        sh 'npm run --silent tl -- lint'
        sh 'npm run --silent tl -- trace'
      }
    }

    stage('Select tests') {
      steps {
        script {
          if (params.ENV != 'demo' && !env."BASE_URL_${params.ENV.toUpperCase()}") {
            error "Set the Jenkins variable BASE_URL_${params.ENV.toUpperCase()}"
          }
          env.TARGET_URL = params.ENV == 'demo' ? '' : env."BASE_URL_${params.ENV.toUpperCase()}"
          def base = env.CHANGE_TARGET ?: 'main'
          if (params.TAGS?.trim()) {
            env.GREP = params.TAGS.trim()
          } else if (params.RUN_MODE == 'smoke') {
            env.GREP = '@smoke'
          } else if (params.RUN_MODE == 'smart') {
            env.GREP = sh(script: "npm run --silent tl -- select --base origin/${base}", returnStdout: true).trim()
          } else {
            env.GREP = ''
          }
          echo "Selection: ${env.GREP ?: 'full suite'}"
        }
      }
    }

    stage('Test') {
      steps {
        script {
          int total = params.SHARDS.toInteger()
          def shards = (1..total).collectEntries { i ->
            ["shard ${i}/${total}".toString(), {
              withEnv([
                "SHARD=${i}/${total}",
                "TRUTHLINE_SHARD=${i}",
                "DEMO_PORT=${4172 + i}",
                "PLAYWRIGHT_BLOB_OUTPUT_FILE=blob-report/blocking/shard-${i}.zip",
              ]) {
                // A failing shard must not stop the others. `tl gate` decides the build status.
                sh(returnStatus: true, script: '''
                  [ -z "$TARGET_URL" ] || export BASE_URL="$TARGET_URL"
                  export TEST_USER_EMAIL="$TEST_USER_USR" TEST_USER_PASSWORD="$TEST_USER_PSW"
                  npx playwright test --shard="$SHARD" --output="test-results/shard-$TRUTHLINE_SHARD" \
                    --pass-with-no-tests ${GREP:+--grep "$GREP"}
                ''')
              }
            }]
          }
          parallel shards
        }
      }
    }

    stage('Quarantine') {
      steps {
        withEnv([
          'TRUTHLINE_QUARANTINE=1',
          'TRUTHLINE_SHARD=q',
          'DEMO_PORT=4199',
          'PLAYWRIGHT_BLOB_OUTPUT_FILE=blob-report/quarantine/quarantine.zip',
        ]) {
          sh(returnStatus: true, script: '''
            [ -z "$TARGET_URL" ] || export BASE_URL="$TARGET_URL"
            export TEST_USER_EMAIL="$TEST_USER_USR" TEST_USER_PASSWORD="$TEST_USER_PSW"
            npx playwright test --grep @flaky --pass-with-no-tests --output=test-results/quarantine
          ''')
        }
      }
    }

    stage('Merge reports') {
      steps {
        sh '''
          # A crashed shard leaves no blob and would silently shrink the merged report.
          found=$(ls blob-report/blocking/*.zip | wc -l)
          if [ "$found" -ne "$SHARDS" ]; then
            echo "Expected $SHARDS shard reports, found $found"
            exit 1
          fi
          REPORT_NAME=results npx playwright merge-reports --config playwright.merge.config.ts blob-report/blocking
          if [ -d blob-report/quarantine ]; then
            REPORT_NAME=quarantine npx playwright merge-reports --config playwright.merge.config.ts blob-report/quarantine
          fi
        '''
      }
    }

    stage('Gate') {
      steps {
        script {
          int code = sh(returnStatus: true, script: 'npm run --silent tl -- gate reports/results.json --quarantine reports/quarantine.json')
          if (code == 2) {
            unstable('Only quarantined tests failed.')
          } else if (code != 0) {
            error('Blocking test failures.')
          }
        }
      }
    }
  }

  post {
    always {
      // The gate owns the build status, so JUnit only records results.
      junit testResults: 'reports/*.xml', allowEmptyResults: true, skipMarkingBuildUnstable: true
      publishHTML(target: [
        reportDir: 'playwright-report/results',
        reportFiles: 'index.html',
        reportName: 'Playwright Report',
        keepAll: true,
        alwaysLinkToLastBuild: true,
        allowMissing: true,
      ])
    }
    failure {
      sh 'npm run --silent tl -- triage reports/results.json --build "$BUILD_NUMBER" || true'
      archiveArtifacts artifacts: "test-results/**, truthline/triage/${env.BUILD_NUMBER}.md", allowEmptyArchive: true
    }
    unstable {
      sh 'npm run --silent tl -- triage reports/quarantine.json --build "$BUILD_NUMBER" || true'
      archiveArtifacts artifacts: "test-results/**, truthline/triage/${env.BUILD_NUMBER}.md", allowEmptyArchive: true
    }
    cleanup {
      cleanWs()
    }
  }
}
