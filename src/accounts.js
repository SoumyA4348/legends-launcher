// Saved Microsoft accounts: { active: uuid, accounts: { [uuid]: mclcAuth } }.
// Pure functions over the store object; main.js handles the encrypted file.

const MAX_ACCOUNTS = 10;

function isAuth(value) {
  return Boolean(value && value.access_token && value.name && value.uuid);
}

// Older versions saved a single MCLC auth object: it becomes the only account.
function normalizeStore(parsed) {
  if (isAuth(parsed)) {
    return { active: parsed.uuid, accounts: { [parsed.uuid]: parsed } };
  }
  const accounts = {};
  if (parsed && typeof parsed.accounts === "object" && parsed.accounts) {
    for (const auth of Object.values(parsed.accounts)) {
      if (isAuth(auth)) accounts[auth.uuid] = auth;
    }
  }
  const active = parsed && accounts[parsed.active] ? parsed.active : Object.keys(accounts)[0] || null;
  return { active, accounts };
}

function activeAccount(store) {
  return (store.active && store.accounts[store.active]) || null;
}

// Adds or refreshes an account and makes it active.
function upsertAccount(store, auth) {
  if (!isAuth(auth)) {
    return store;
  }
  const accounts = { ...store.accounts, [auth.uuid]: auth };
  const ids = Object.keys(accounts);
  if (ids.length > MAX_ACCOUNTS) {
    // Drop the oldest other account; object keys keep insertion order.
    delete accounts[ids.find((id) => id !== auth.uuid)];
  }
  return { active: auth.uuid, accounts };
}

function removeAccount(store, uuid) {
  const accounts = { ...store.accounts };
  delete accounts[uuid];
  const active = store.active === uuid ? Object.keys(accounts)[0] || null : store.active;
  return { active, accounts };
}

function switchAccount(store, uuid) {
  return store.accounts[uuid] ? { ...store, active: uuid } : store;
}

// What the renderer may see: never tokens.
function listAccounts(store) {
  return Object.values(store.accounts).map((auth) => ({
    name: auth.name,
    uuid: auth.uuid,
    active: auth.uuid === store.active
  }));
}

module.exports = { normalizeStore, activeAccount, upsertAccount, removeAccount, switchAccount, listAccounts, MAX_ACCOUNTS };
