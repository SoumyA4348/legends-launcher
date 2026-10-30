const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNewsItems, MAX_ITEMS } = require("../src/news");

const patchNotes = {
  entries: [
    { type: "snapshot", title: "Minecraft 26.4 Snapshot 6", version: "26.4-snapshot-6", date: "2026-10-27T13:40:29.000Z", shortText: "x" },
    {
      type: "release",
      title: "Minecraft: Java Edition 26.3",
      version: "26.3",
      date: "2026-09-15T11:23:02.000Z",
      shortText: "Wilderness Bound is out now!",
      image: { url: "/v2/images/dappledcamp540x540.jpg" }
    }
  ]
};
const news = {
  entries: [
    { newsType: ["News page", "Bedrock"], title: "Bedrock promo", date: "2026-10-29", readMoreLink: "https://www.minecraft.net/a" },
    {
      newsType: ["Java", "News page"],
      title: "Camp Out Challenge",
      text: "  Join   the challenge  ",
      date: "2026-09-26",
      readMoreLink: "https://www.minecraft.net/article/camp-out?OCID=Launcher",
      playPageImage: { url: "/v2/images/camp.png" }
    },
    { newsType: ["Java"], title: "Phishing", date: "2026-09-30", readMoreLink: "https://evil.example/x" },
    { newsType: ["Java"], title: "Older", date: "2026-09-01", readMoreLink: "http://www.minecraft.net/old" }
  ]
};

test("builds Java release notes and Java news only, with safe links and images", () => {
  const items = buildNewsItems({ news, patchNotes, releases: [] });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    kind: "release",
    title: "Java Edition 26.3",
    text: "Wilderness Bound is out now!",
    date: "2026-09-15T11:23:02.000Z",
    image: "https://launchercontent.mojang.com/v2/images/dappledcamp540x540.jpg",
    url: "https://minecraft.wiki/w/Java_Edition_26.3"
  });
  assert.equal(items[1].title, "Camp Out Challenge");
  assert.equal(items[1].text, "Join the challenge");
  assert.equal(items[1].url, "https://www.minecraft.net/article/camp-out?OCID=Launcher");
  assert.equal(items[1].image, "https://launchercontent.mojang.com/v2/images/camp.png");
});

test("a published launcher release comes first; drafts and foreign links are ignored", () => {
  const releases = [
    { draft: true, tag_name: "v0.3.0", html_url: "https://github.com/SoumyA4348/legends-launcher/releases/tag/v0.3.0", published_at: "2026-11-01T00:00:00Z" },
    { tag_name: "v0.2.0", body: "## Skins and news\nMore text", html_url: "https://github.com/SoumyA4348/legends-launcher/releases/tag/v0.2.0", published_at: "2026-10-31T00:00:00Z" }
  ];
  const items = buildNewsItems({ news, patchNotes, releases });
  assert.equal(items.length, MAX_ITEMS);
  assert.deepEqual(items.map((item) => item.kind), ["launcher", "release", "news"]);
  assert.equal(items[0].title, "Legends Launcher v0.2.0");
  assert.equal(items[0].text, "Skins and news");

  const foreign = [{ tag_name: "v9", html_url: "https://github.com/someone/else/releases/tag/v9", published_at: "2026-10-31T00:00:00Z" }];
  assert.equal(buildNewsItems({ news, patchNotes, releases: foreign })[0].kind, "release");
});

test("missing or broken feeds give an empty list instead of throwing", () => {
  assert.deepEqual(buildNewsItems({ news: null, patchNotes: undefined, releases: { message: "rate limited" } }), []);
  assert.deepEqual(buildNewsItems({ news: { entries: [{ newsType: ["Java"] }] }, patchNotes: { entries: "x" }, releases: null }), []);
});
