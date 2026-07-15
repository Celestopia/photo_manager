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
import {
  buildGalleryMediaDetailRows,
  formatMediaResolution,
  formatVideoFrameRate,
} from "../src/renderer/domain/gallery-media-details.mjs";

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

test("gallery image details use the fixed compact field sequence", () => {
  const rows = buildGalleryMediaDetailRows({
    FilePath: "旅行/IMG_0001.jpg",
    FileSystem: {
      FileType: "image",
      FileSize: 3 * 1024 * 1024,
      ShootingTimeString: "2026-07-14 10:20:30",
      ModificationTimeString: "2026-07-14 10:21:00",
    },
    Picture: { Width: 4096, Height: 3072 },
    Location: { Place: "清华大学", Detail: "不在菜单中显示" },
    Customization: { Tags: ["校园", "建筑"] },
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    ["文件名", "拍摄日期", "修改日期", "文件大小", "分辨率", "地点", "标签"],
  );
  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.key, row.value])),
    {
      filename: "IMG_0001.jpg",
      "shooting-date": "2026-07-14 10:20:30",
      "modification-date": "2026-07-14 10:21:00",
      "file-size": "3.00 MB",
      resolution: "4096x3072",
      location: "清华大学",
      tags: "校园, 建筑",
    },
  );
});

test("gallery video details add frame rate and duration before location", () => {
  const rows = buildGalleryMediaDetailRows({
    FilePath: "VID_0001.mp4",
    FileSystem: { FileType: "video", FileSize: 1024 },
    Video: { DisplayWidth: 1920, DisplayHeight: 1080, FrameRate: 29.97003, DurationSeconds: 65.8 },
    Location: { Place: "" },
    Customization: { Tags: [] },
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    ["文件名", "拍摄日期", "修改日期", "文件大小", "分辨率", "帧率", "时长", "地点", "标签"],
  );
  assert.equal(formatMediaResolution({ FileSystem: { FileType: "video" }, Video: { DisplayWidth: 1920, DisplayHeight: 1080 } }), "1920x1080");
  assert.equal(formatVideoFrameRate(29.97003), "29.97 fps");
  assert.equal(rows.find((row) => row.key === "duration").value, "1:05");
  assert.equal(rows.find((row) => row.key === "location").value, "-");
  assert.equal(rows.find((row) => row.key === "tags").value, "-");
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
