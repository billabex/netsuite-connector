const SuiteCloudJestConfiguration = require("@oracle/suitecloud-unit-testing/jest-configuration/SuiteCloudJestConfiguration");
const cliConfig = require("./suitecloud.config");

module.exports = {
  passWithNoTests: true,
  ...SuiteCloudJestConfiguration.build({
    projectFolder: cliConfig.defaultProjectFolder,
    projectType: SuiteCloudJestConfiguration.ProjectType.ACP,
  }),
};
