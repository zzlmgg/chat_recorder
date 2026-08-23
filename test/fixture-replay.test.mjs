import { test } from "node:test";
import { replayCapturedFixture } from "../test-support/target-stack-replay.mjs";

for (const entrypoint of ["sdk-cli", "claude-vscode"]) {
  test(
    `the captured ${entrypoint} Model Exchange replays through the assembled Recorder`,
    { timeout: 10_000 },
    async (t) => {
      await replayCapturedFixture(t, entrypoint);
    },
  );
}
