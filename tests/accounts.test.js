const test = require("node:test");
const assert = require("node:assert/strict");
const accounts = require("../src/accounts");

const auth = (uuid, name = uuid) => ({ access_token: `t-${uuid}`, name, uuid, meta: { refresh: "r" } });

test("normalizeStore migrates a single saved account and drops junk", () => {
  const store = accounts.normalizeStore(auth("a", "Steve"));
  assert.equal(store.active, "a");
  assert.equal(accounts.activeAccount(store).name, "Steve");

  assert.deepEqual(accounts.normalizeStore(null), { active: null, accounts: {} });
  const mixed = accounts.normalizeStore({ active: "gone", accounts: { x: { name: "no token" }, b: auth("b") } });
  assert.deepEqual(Object.keys(mixed.accounts), ["b"]);
  assert.equal(mixed.active, "b");
});

test("upsert, switch and remove keep one active account", () => {
  let store = accounts.normalizeStore(null);
  store = accounts.upsertAccount(store, auth("a"));
  store = accounts.upsertAccount(store, auth("b"));
  assert.equal(store.active, "b");

  store = accounts.switchAccount(store, "a");
  assert.equal(store.active, "a");
  assert.equal(accounts.switchAccount(store, "missing").active, "a");

  store = accounts.removeAccount(store, "a");
  assert.equal(store.active, "b");
  store = accounts.removeAccount(store, "b");
  assert.equal(store.active, null);
  assert.equal(accounts.activeAccount(store), null);
});

test("upsert caps saved accounts and listAccounts never exposes tokens", () => {
  let store = accounts.normalizeStore(null);
  for (let i = 0; i < accounts.MAX_ACCOUNTS + 2; i++) store = accounts.upsertAccount(store, auth(`u${i}`));
  assert.equal(Object.keys(store.accounts).length, accounts.MAX_ACCOUNTS);
  assert.equal(store.active, `u${accounts.MAX_ACCOUNTS + 1}`);

  const listed = accounts.listAccounts(store);
  assert.ok(listed.every((entry) => !("access_token" in entry) && !("meta" in entry)));
  assert.equal(listed.filter((entry) => entry.active).length, 1);
});
