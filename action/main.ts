import * as core from '@actions/core';

import { runAction } from './run.js';

void runAction({
  getInput: (name, opts) => core.getInput(name, opts),
  info: (message) => core.info(message),
  warning: (message) => core.warning(message),
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: (message) => core.setFailed(message),
});
