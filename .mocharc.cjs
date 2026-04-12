const path = require("path");
process.env.ANCHOR_PROVIDER_URL ??= "http://127.0.0.1:8899";
process.env.ANCHOR_WALLET ??= path.join(__dirname, "keys/test-wallet.json");

module.exports = {
  require: ["tsx/cjs", "./tests/hooks.ts"],
  spec: "tests/**/*.ts",
  timeout: 1000000,
};
