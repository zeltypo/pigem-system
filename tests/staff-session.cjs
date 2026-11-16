// Two tabs share localStorage and database rows, and have independent sessionStorage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("web/js/db.js", "utf8");

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const shared = storage();
const users = ["manager", "agent"].map(role => ({
  id: role, username: role, email: role + "@example.test", role, password_hash: "test-hash",
}));

function tab(browserStorage = shared) {
  const session = storage();
  const window = {
    SYSTEM: "staff",
    supabase: {
      createClient(_url, _key, { auth }) {
        return {
          auth: {
            async signInWithPassword({ email }) {
              const user = users.find(row => row.email === email);
              auth.storage.setItem(auth.storageKey, user.role);
              return { error: null };
            },
            async getSession() {
              const role = auth.storage.getItem(auth.storageKey);
              const user = users.find(row => row.role === role);
              return { data: { session: user ? {
                access_token: role + "-jwt", user: { email: user.email, app_metadata: { role } },
              } : null } };
            },
            async signOut({ scope }) {
              assert.equal(scope, "local");
              auth.storage.removeItem(auth.storageKey);
            },
          },
          from(table) {
            assert.equal(table, "users");
            const filters = [];
            let changes;
            const matching = () => users.filter(row => filters.every(([field, value]) => row[field] === value));
            const query = {
              select: () => query,
              update(values) { changes = values; return query; },
              eq(field, value) { filters.push([field, value]); return query; },
              ilike(field, value) { return query.eq(field, value); },
              async maybeSingle() { return { data: matching()[0] }; },
              then(resolve) {
                matching().forEach(row => Object.assign(row, changes));
                resolve({ error: null });
              },
            };
            return query;
          },
        };
      },
    },
  };
  const context = vm.createContext({
    window, document: { addEventListener() {} }, console,
    localStorage: browserStorage, sessionStorage: session,
    CONFIG: { SUPABASE_URL: "test", SUPABASE_ANON_KEY: "test" },
  });
  vm.runInContext(source, context);
  context.hashPassword = async () => "test-hash";
  context.dbAddLoginHistory = async () => {};
  return context;
}

async function run() {
  const managerTab = tab();
  const agentTab = tab();
  await managerTab.dbSignIn("manager", "password");
  assert.equal(await agentTab.dbGetCurrentUser(), null);
  await agentTab.dbSignIn("agent", "password");
  assert.equal((await managerTab.checkPageAccess(["manager"])).role, "manager");
  assert.equal((await agentTab.checkPageAccess(["agent"])).role, "agent");
  assert.equal(await managerTab.dbGetToken(), "manager-jwt");
  assert.equal(await agentTab.dbGetToken(), "agent-jwt");
  const returningTab = tab();
  assert.equal((await returningTab.checkPageAccess(["manager"])).role, "manager");
  const differentBrowser = tab(storage());
  assert.equal(differentBrowser.getActiveSessionPair(["manager"]).id, "");
  await agentTab.dbSignOut(true);
  assert.equal(tab().getActiveSessionPair(["agent"]).id, "");
  assert.equal(await agentTab.dbGetToken(), "");
  assert.equal(await managerTab.dbGetToken(), "manager-jwt");
  assert.equal((await managerTab.dbVerifyActiveSession("manager", ["manager"])).valid, true);
  // A second browser signing into the same account replaces only that account's session.
  await differentBrowser.dbSignIn("manager", "password");
  assert.equal((await managerTab.dbVerifyActiveSession("manager", ["manager"])).reason, "other_device");
  assert.equal((await differentBrowser.dbVerifyActiveSession("manager", ["manager"])).valid, true);
  users.push({ id: "second-agent", role: "agent", username: "agent2", email: "agent2@example.test", password_hash: "test-hash" });
  await agentTab.dbSignIn("agent", "password");
  const anotherAgent = tab();
  await anotherAgent.dbSignIn("agent2", "password");
  assert.equal((await agentTab.dbVerifyActiveSession("agent", ["agent"])).reason, "account_switched");
  assert.equal((await anotherAgent.dbVerifyActiveSession("second-agent", ["agent"])).valid, true);
  console.log("PASS: independent staff portal sign-in, screening tokens and sign-out");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
