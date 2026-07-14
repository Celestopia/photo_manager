import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImageUrl,
  formatBitRate,
  formatDuration,
  formatFileSize,
} from "../src/renderer/domain/media-formatters.mjs";
import {
  buildLocationHierarchyRows,
  getLocationManagerRowContext,
} from "../src/renderer/domain/location-hierarchy.mjs";

test("renderer media formatters preserve display semantics", () => {
  assert.equal(formatFileSize(1024 * 1024), "1.00 MB");
  assert.equal(formatDuration(3661.9), "1:01:01");
  assert.equal(formatBitRate(8000000), "8.00 Mbps");
});

test("local media paths are encoded as file URLs", () => {
  assert.equal(
    buildImageUrl("C:\\图库\\a b.jpg"),
    "file:///C:/%E5%9B%BE%E5%BA%93/a%20b.jpg",
  );
});

test("location hierarchy keeps child locations immediately after their parent", () => {
  const rows = buildLocationHierarchyRows([
    {
      Name: "清华大学东南门外餐厅",
      Country: "中国",
      Province: "",
      City: "北京",
      Parent: "",
      Path: ["清华大学东南门外餐厅"],
    },
    {
      Name: "清华大学观畴园食堂",
      Country: "中国",
      Province: "",
      City: "北京",
      Parent: "清华大学",
      Path: ["清华大学", "清华大学观畴园食堂"],
    },
    {
      Name: "清华大学",
      Country: "中国",
      Province: "",
      City: "北京",
      Parent: "",
      Path: ["清华大学"],
    },
  ]);

  const locationRows = rows.filter((row) => row.Type === "location");
  assert.deepEqual(
    locationRows.map((row) => row.Label),
    ["清华大学", "清华大学观畴园食堂", "清华大学东南门外餐厅"],
  );
  assert.deepEqual(locationRows.map((row) => row.Depth), [2, 3, 2]);
});

test("location hierarchy emits administrative rows and stable manager context", () => {
  const rows = buildLocationHierarchyRows([
    {
      Name: "南京",
      Country: "中国",
      Province: "江苏",
      City: "南京",
      Parent: "",
      Path: ["南京"],
    },
    {
      Name: "五一广场",
      Country: "中国",
      Province: "湖南",
      City: "长沙",
      Parent: "",
      Path: ["五一广场"],
    },
  ]);

  assert.deepEqual(
    rows.filter((row) => row.Type === "group").map((row) => [row.Label, row.Depth]),
    [["中国", 0], ["湖南", 1], ["长沙", 2], ["江苏", 1], ["南京", 2]],
  );
  const locationRow = rows.find((row) => row.Label === "五一广场");
  assert.equal(getLocationManagerRowContext(locationRow), "中国 | 湖南 | 长沙");
});
