const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "atotal-build-test-"));
try {
  fs.mkdirSync(path.join(temporary, "work"));
  fs.mkdirSync(path.join(temporary, "outputs"));
  for (const filename of fs.readdirSync(__dirname)) {
    if (filename.endsWith(".js")) fs.copyFileSync(path.join(__dirname, filename), path.join(temporary, "work", filename));
    if (filename.endsWith(".json")) fs.symlinkSync(path.join(__dirname, filename), path.join(temporary, "work", filename));
  }
  const comparison = "national-team-holdings-comparison-20261026.json";
  fs.symlinkSync(path.join(root, "outputs", comparison), path.join(temporary, "outputs", comparison));
  const target = path.join(temporary, "index.html");
  fs.writeFileSync(target, "previous complete dashboard");
  const lateModule = path.join(temporary, "work", "add_national_team_etf_module.js");
  const original = fs.readFileSync(lateModule);
  fs.writeFileSync(lateModule, 'throw new Error("injected late module failure");');
  const build = () => spawnSync(process.execPath,
    [path.join(temporary, "work", "build_market_dashboard.js"), "--online-only", "--skip-refresh"],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const failed = build();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /injected late module failure/);
  assert.equal(fs.readFileSync(target, "utf8"), "previous complete dashboard");
  assert.equal(fs.readdirSync(temporary).filter(name => name.startsWith(".dashboard-build-")).length, 0);
  fs.writeFileSync(lateModule, original);
  const succeeded = build();
  assert.equal(succeeded.status, 0, succeeded.stderr);
  const html = fs.readFileSync(target, "utf8");
  for (const id of ["valuation", "retail-sentiment", "large-money-sentiment", "official-sentiment", "national-team-etf"]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.equal(fs.readdirSync(temporary).filter(name => name.startsWith(".dashboard-build-")).length, 0);
  console.log("Atomic build: late failure preserves previous page; complete build replaces it.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
