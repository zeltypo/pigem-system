var SYSTEM = window.SYSTEM || "customer";

var SYSTEM_ROLES = {
  customer: ["customer"],
  staff: ["agent", "manager"],
  admin: ["admin"]
};

var SESSION_KEY = "pigem_session_" + SYSTEM;
var SESSION_TOKEN_KEY = SESSION_KEY + "_tok";
var sessionStore = localStorage;

var IS_DEMO_MODE = (CONFIG.SUPABASE_URL === "" || CONFIG.SUPABASE_ANON_KEY === "");
var supabaseClient = null;

if (!IS_DEMO_MODE && window.supabase) {

  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { storageKey: "pigem-" + SYSTEM, storage: sessionStore }
  });
}

function generateSessionToken() {
  return "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
}

function parsePasswordHistory(raw) {
  if (Array.isArray(raw)) return raw.slice();
  if (typeof raw === "string" && raw.trim()) {
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {}
  }
  return [];
}

function checkPasswordHistoryReuse(userRow, newHash) {
  if (!userRow || !newHash) return { reused: false };
  var currentHash = String(userRow.password_hash || "");
  if (currentHash && currentHash === newHash) {
    var curAt = userRow.password_changed_at || userRow.created_at || "";
    var timeLabel = typeof formatElapsedTimeAgo === "function" ? formatElapsedTimeAgo(curAt) : "recently";
    return {
      reused: true,
      isCurrent: true,
      timeAgo: timeLabel,
      message: "You cannot reuse your current password (last changed " + timeLabel + "). Please choose a new password."
    };
  }
  var hist = parsePasswordHistory(userRow.password_history);
  for (var i = 0; i < hist.length; i++) {
    var entry = hist[i];
    if (entry && entry.hash && String(entry.hash) === newHash) {
      var oldLabel = typeof formatElapsedTimeAgo === "function" ? formatElapsedTimeAgo(entry.changed_at) : "previously";
      return {
        reused: true,
        isCurrent: false,
        timeAgo: oldLabel,
        message: "You cannot reuse a previous password that was changed " + oldLabel + ". Please choose a new password."
      };
    }
  }
  return { reused: false };
}

function buildNextPasswordHistory(userRow) {
  var hist = parsePasswordHistory(userRow && userRow.password_history);
  if (userRow && userRow.password_hash) {
    hist.unshift({
      hash: String(userRow.password_hash),
      changed_at: userRow.password_changed_at || userRow.created_at || new Date().toISOString()
    });
  }
  return hist.slice(0, 10);
}

async function dbBindSingleDeviceSession(userObj) {
  if (!userObj || !userObj.id) return "";
  var tok = generateSessionToken();
  sessionStore.setItem(SESSION_KEY, userObj.id);
  sessionStore.setItem(SESSION_TOKEN_KEY, tok);
  userObj.session_token = tok;
  if (IS_DEMO_MODE) {
    var users = getDemoUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === userObj.id) {
        users[i].session_token = tok;
        break;
      }
    }
    writeSaved("pigem_users", users);
  }
  if (!IS_DEMO_MODE && supabaseClient) {
    try {
      var upRes = await supabaseClient.from("users").update({ session_token: tok }).eq("id", userObj.id);
      if (upRes.error) {
        console.warn("Session token update error:", upRes.error.message);
      }
    } catch (e) {}
  }
  return tok;
}

async function dbVerifyActiveSession(expectedUserId, allowedRoles) {
  var currentId = sessionStore.getItem(SESSION_KEY);
  var localTok = sessionStore.getItem(SESSION_TOKEN_KEY);
  if (!currentId) return { valid: false, reason: "missing" };
  var allowedForSystem = SYSTEM_ROLES[SYSTEM] || null;
  if (typeof allowedRoles === "string") allowedRoles = [allowedRoles];

  var userRow = null;
  if (IS_DEMO_MODE) {
    var list = getDemoUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === currentId) {
        userRow = list[i];
        break;
      }
    }
    if (!userRow) return { valid: false, reason: "missing" };
  } else {
    if (!supabaseClient) return { valid: true };
    var res = await supabaseClient.from("users").select("id,active,session_token,role").eq("id", currentId).maybeSingle();
    if (res.error) return { valid: true };
    if (!res.data) return { valid: false, reason: "missing" };
    userRow = res.data;
  }

  var role = String(userRow.role || "").trim().toLowerCase();
  if (allowedForSystem && allowedForSystem.indexOf(role) === -1) {
    return { valid: false, reason: "wrong_system" };
  }
  if (userRow.active === false) return { valid: false, reason: "disabled" };
  if (expectedUserId && currentId !== expectedUserId) {
    var switchTarget = (typeof getHomeForRole === "function" && (!allowedForSystem || allowedForSystem.indexOf(role) !== -1))
      ? getHomeForRole(role)
      : getLoginPage();
    return { valid: false, reason: "account_switched", role: role, redirectUrl: switchTarget };
  }
  if (allowedRoles && allowedRoles.length > 0 && allowedRoles.indexOf(role) === -1) {
    return {
      valid: false,
      reason: "wrong_portal",
      role: role,
      redirectUrl: typeof getHomeForRole === "function" ? getHomeForRole(role) : getLoginPage()
    };
  }
  if (userRow.session_token && !localTok) {
    return { valid: false, reason: "missing" };
  }
  if (userRow.session_token && localTok && userRow.session_token !== localTok) {
    return { valid: false, reason: "other_device" };
  }
  return { valid: true };
}

async function hashPassword(plainText) {
  if (!plainText) return "";
  try {
    var msgBuffer = new TextEncoder().encode(plainText);
    var hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  } catch (e) {
    return plainText;
  }
}

var DEFAULT_DEMO_USERS = [];

function getDemoUsers() {
  var users = readSaved("pigem_users", []);
  if (!Array.isArray(users)) users = [];

  var clean = users.filter(function (u) {
    return u && u.id && u.id.indexOf("demo-") !== 0 && (u.email || "").indexOf("@demo.test") === -1;
  });
  if (clean.length !== users.length) {
    writeSaved("pigem_users", clean);
  }
  return clean;
}

function findDemoUserByEmail(email) {
  var target = String(email || "").trim().toLowerCase();
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || "").toLowerCase() === target) return users[i];
  }
  return null;
}

function findDemoUserByUsername(username) {
  var target = String(username || "").trim().toLowerCase();
  if (!target) return null;
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username || "").toLowerCase() === target) return users[i];
  }
  return null;
}

async function dbIsUsernameTaken(username, excludeUserId) {
  var clean = String(username || "").trim().toLowerCase();
  if (!clean) return false;

  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("users").select("id, username").ilike("username", clean).limit(5);
    if (res.data && res.data.length > 0) {
      for (var i = 0; i < res.data.length; i++) {
        if (res.data[i].id !== excludeUserId) return true;
      }
    }
    return false;
  }

  var localMatch = findDemoUserByUsername(clean);
  if (localMatch && localMatch.id !== excludeUserId) {
    return true;
  }
  return false;
}

async function dbGenerateUniqueUsername(fullName, email, preferredUsername) {
  var seed = String(preferredUsername || "").trim().toLowerCase();
  if (!seed || (typeof isValidUsername === "function" && !isValidUsername(seed))) {
    seed = (typeof sanitizeUsernameSeed === "function")
      ? sanitizeUsernameSeed(fullName, email)
      : (String(email || "user").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 24) || "user_account");
  }
  if (seed.length < 3) seed = (seed + "_user").slice(0, 24);

  var candidate = seed.slice(0, 30);
  if (!(await dbIsUsernameTaken(candidate, null))) {
    return candidate;
  }

  for (var attempt = 1; attempt <= 25; attempt++) {
    var suffix = attempt <= 9 ? String(attempt) : String(Math.floor(100 + Math.random() * 900));
    var trimmedBase = seed.slice(0, Math.max(3, 30 - suffix.length - 1));
    var nextCandidate = trimmedBase + "_" + suffix;
    if (!(await dbIsUsernameTaken(nextCandidate, null))) {
      return nextCandidate;
    }
  }
  return (seed.slice(0, 22) + "_" + String(Date.now()).slice(-6));
}

async function dbGetSuggestedUsername(email) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  var local = findDemoUserByEmail(cleanEmail);
  if (local && local.username) return local.username;
  if (!IS_DEMO_MODE && supabaseClient && cleanEmail) {
    try {
      var res = await supabaseClient.from("users").select("username, full_name").eq("email", cleanEmail).maybeSingle();
      if (res.data && res.data.username) return res.data.username;
      if (res.data && res.data.full_name) return await dbGenerateUniqueUsername(res.data.full_name, cleanEmail);
    } catch (e) {}
  }
  return await dbGenerateUniqueUsername("", cleanEmail);
}

function getLoginPage() {
  if (SYSTEM === "staff") return ROOT + "staff-login.html";
  if (SYSTEM === "admin") return ROOT + "admin-login.html";
  return ROOT + "login.html";
}

async function dbGetCurrentUser() {
  var currentId = sessionStore.getItem(SESSION_KEY);
  var allowedForSystem = SYSTEM_ROLES[SYSTEM] || null;
  if (currentId) {
    if (!IS_DEMO_MODE && supabaseClient) {
      var dbUser = await supabaseClient.from("users").select("*").eq("id", currentId).maybeSingle();
      if (dbUser.data) {
        var normRole = String(dbUser.data.role || "").trim().toLowerCase();
        dbUser.data.role = normRole;
        if (
          dbUser.data.active !== false &&
          (!allowedForSystem || allowedForSystem.indexOf(normRole) !== -1)
        ) {
          return dbUser.data;
        }
      }
      return null;
    }
    var localUsers = getDemoUsers();
    for (var i = 0; i < localUsers.length; i++) {
      var localRole = String(localUsers[i].role || "").trim().toLowerCase();
      if (
        localUsers[i].id === currentId &&
        localUsers[i].active !== false &&
        (!allowedForSystem || allowedForSystem.indexOf(localRole) !== -1)
      ) {
        localUsers[i].role = localRole;
        return localUsers[i];
      }
    }
    return null;
  }

  if (IS_DEMO_MODE || !supabaseClient || SYSTEM !== "customer") return null;

  var sessionRes = await supabaseClient.auth.getSession();
  var session = sessionRes.data.session;
  if (!session) return null;

  var authUser = session.user;
  var res = await supabaseClient.from("users").select("*").eq("email", authUser.email).maybeSingle();
  if (!res.data) {
    var displayName = (authUser.user_metadata && authUser.user_metadata.full_name) || authUser.email;
    var generatedUsername = await dbGenerateUniqueUsername(displayName, authUser.email);
    var row = {
      id: authUser.id,
      username: generatedUsername,
      email: authUser.email,
      full_name: displayName,
      role: "customer",
      active: true,
      activated: true
    };
    await supabaseClient.from("users").upsert(row, { onConflict: "email" });
    return row;
  }
  var authRole = String(res.data.role || "").trim().toLowerCase();
  res.data.role = authRole;
  if (res.data.active === false) return null;
  if (SYSTEM_ROLES[SYSTEM] && SYSTEM_ROLES[SYSTEM].indexOf(authRole) === -1) return null;
  return res.data;
}

async function dbSignIn(identifier, password) {
  var cleanInput = String(identifier || "").trim().toLowerCase();
  if (!cleanInput) {
    throw new Error((SYSTEM === "staff" || SYSTEM === "admin") ? "Please enter your username." : "Please enter your username or email address.");
  }

  var enteredHash = await hashPassword(password);

  if (SYSTEM === "staff" || SYSTEM === "admin") {
    if (cleanInput.indexOf("@") !== -1) {
      throw new Error("Internal accounts sign in using Username only. Email login is not used for Admin, Manager, or Agent accounts.");
    }
    var cleanStaffUser = cleanInput.replace(/^@/, "");
    if (typeof isValidUsername === "function" && !isValidUsername(cleanStaffUser)) {
      throw new Error("Please enter a valid username (3-30 characters).");
    }

    var staffUser = null;
    if (!IS_DEMO_MODE && supabaseClient) {
      var staffRes = await supabaseClient.from("users").select("*").ilike("username", cleanStaffUser).maybeSingle();
      if (staffRes.data) staffUser = staffRes.data;
    } else {
      staffUser = findDemoUserByUsername(cleanStaffUser);
    }

    if (!staffUser) {
      throw new Error("Invalid username or password.");
    }
    if (staffUser.active === false) {
      throw new Error("This account is disabled. Please contact the System Administrator.");
    }
    if (SYSTEM_ROLES[SYSTEM].indexOf(staffUser.role) === -1) {
      if (staffUser.role === "admin") {
        throw new Error("Administrator accounts must sign in on the Admin Login page.");
      }
      if (staffUser.role === "agent" || staffUser.role === "manager") {
        throw new Error("Agent and Manager accounts must sign in on the Internal Login page.");
      }
      throw new Error("Customer accounts must sign in on the Customer Login page.");
    }

    var passMatched = Boolean(
      (staffUser.password_hash && staffUser.password_hash === enteredHash) ||
      (staffUser.password && (staffUser.password === password || staffUser.password === enteredHash)) ||
      (staffUser.activation_code && (
        staffUser.activation_code === ("PW:" + enteredHash) ||
        staffUser.activation_code === ("PW:" + password) ||
        staffUser.activation_code === password
      ))
    );

    if (!passMatched && staffUser.email && !IS_DEMO_MODE && supabaseClient) {
      var legacyAuth = await supabaseClient.auth.signInWithPassword({ email: staffUser.email, password: password });
      if (!legacyAuth.error) {
        passMatched = true;
      }
    }

    if (!passMatched) {
      throw new Error("Invalid username or password.");
    }

    await dbBindSingleDeviceSession(staffUser);
    await dbAddLoginHistory(staffUser, "login");
    return staffUser;
  }

  var cleanEmail = "";
  var preloadedDbRow = null;

  if (cleanInput.indexOf("@") !== -1) {
    cleanEmail = cleanInput;
    if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
      throw new Error("Customer Login accepts @gmail.com accounts or Customer usernames only.");
    }
  } else {
    var cleanCustUser = cleanInput.replace(/^@/, "");
    if (typeof isValidUsername === "function" && !isValidUsername(cleanCustUser)) {
      throw new Error("Please enter a valid username (3-30 characters) or @gmail.com email address.");
    }
    if (!IS_DEMO_MODE && supabaseClient) {
      var uRes = await supabaseClient.from("users").select("*").ilike("username", cleanCustUser).maybeSingle();
      if (uRes.data) {
        preloadedDbRow = uRes.data;
        cleanEmail = String(uRes.data.email || "").trim().toLowerCase();
      }
    } else {
      var localByUser = findDemoUserByUsername(cleanCustUser);
      if (localByUser) {
        preloadedDbRow = localByUser;
        cleanEmail = String(localByUser.email || "").trim().toLowerCase();
      }
    }
    if (preloadedDbRow && preloadedDbRow.role && preloadedDbRow.role !== "customer") {
      throw new Error("This username belongs to an internal staff account. Please use the Staff or Admin Login page.");
    }
    if (!cleanEmail) {
      throw new Error("Invalid username or password.");
    }
    if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
      throw new Error("This username belongs to an internal staff account. Please use the Staff or Admin Login page.");
    }
  }

  var user = null;
  if (IS_DEMO_MODE) {
    var found = findDemoUserByEmail(cleanEmail);
    if (found && (found.password === password || found.password_hash === enteredHash || found.password === enteredHash)) {
      if (found.role === "customer" && !found.activated) {
        throw new Error("Please activate your account first using the activation link sent to your email.");
      }
      if (found.active === false) throw new Error("This account is disabled. Please contact PIGEM.");
      if (!found.username) {
        found.username = await dbGenerateUniqueUsername(found.full_name, found.email);
      }
      user = found;
    } else {
      throw new Error("Invalid username/email or password.");
    }
  } else if (supabaseClient) {
    var dbRow = preloadedDbRow ? { data: preloadedDbRow } : await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
    var rowData = dbRow.data;
    if (rowData) {
      if (rowData.role && rowData.role !== "customer") {
        throw new Error("Internal accounts must sign in on the Staff or Admin Login page.");
      }
      if (rowData.role === "customer" && !rowData.activated) {
        throw new Error("Please create your password first using the one-time activation link sent to your Gmail.");
      }
      if (rowData.active === false) throw new Error("This account is disabled. Please contact PIGEM.");

      var rowMatch = Boolean(
        (rowData.password_hash && rowData.password_hash === enteredHash) ||
        (rowData.activation_code && (
          rowData.activation_code === ("PW:" + enteredHash) ||
          rowData.activation_code === ("PW:" + password) ||
          rowData.activation_code === password
        ))
      );

      if (rowMatch) {
        user = rowData;
      } else if (!rowData.password_hash) {
        var authRes = await supabaseClient.auth.signInWithPassword({ email: cleanEmail, password: password });
        if (authRes.error) throw new Error("Invalid username/email or password.");
        user = (await dbGetCurrentUser()) || rowData;
      } else {
        throw new Error("Invalid username/email or password.");
      }
    } else {
      var res = await supabaseClient.auth.signInWithPassword({ email: cleanEmail, password: password });
      if (res.error) throw new Error(res.error.message);
      user = await dbGetCurrentUser();
      if (!user) throw new Error("Account record not found or disabled. Please contact PIGEM.");
    }
  } else {
    throw new Error("Invalid username/email or password.");
  }

  if (SYSTEM_ROLES[SYSTEM].indexOf(user.role) === -1) {
    if (!IS_DEMO_MODE && supabaseClient) await supabaseClient.auth.signOut();
    throw new Error("This account cannot sign in here.");
  }

  await dbBindSingleDeviceSession(user);
  await dbAddLoginHistory(user, "login");
  return user;
}

async function dbSignOut(clearServerToken) {
  var user = await dbGetCurrentUser();
  var localTok = sessionStore.getItem(SESSION_TOKEN_KEY);
  if (user) {
    await dbAddLoginHistory(user, "logout");
    if (clearServerToken !== false && !IS_DEMO_MODE && supabaseClient && localTok) {
      try {
        await supabaseClient.from("users").update({ session_token: null })
          .eq("id", user.id).eq("session_token", localTok);
      } catch (e) {}
    }
  }
  sessionStore.removeItem(SESSION_KEY);
  sessionStore.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem("pigem_user_cache");
  if (!IS_DEMO_MODE && supabaseClient) {
    try { await supabaseClient.auth.signOut(); } catch (e) {}
  }
}

async function dbResetPassword(email) {
  if (IS_DEMO_MODE) return;
  var res = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (res.error) throw new Error(res.error.message);
}

async function dbGetToken() {
  if (IS_DEMO_MODE) return "";
  var res = await supabaseClient.auth.getSession();
  return res.data.session ? res.data.session.access_token : "";
}

async function checkPageAccess(allowedRoles) {
  if (typeof allowedRoles === "string") allowedRoles = [allowedRoles];
  window.PORTAL_ALLOWED_ROLES = allowedRoles;
  if (sessionStore.getItem(SESSION_KEY) && typeof dbVerifyActiveSession === "function") {
    var chk = await dbVerifyActiveSession(null, allowedRoles);
    if (chk && chk.valid === false) {
      if (chk.reason === "wrong_portal" && chk.redirectUrl) {
        window.location.replace(chk.redirectUrl);
        return null;
      }
      await signOutAndGoLogin(chk.reason === "other_device" || chk.reason === "disabled" ? chk.reason : "", false);
      return null;
    }
  }
  var user = await dbGetCurrentUser();
  if (!user) {
    window.location.replace(getLoginPage());
    return null;
  }
  var userRole = String(user.role || "").trim().toLowerCase();
  if (allowedRoles.indexOf(userRole) === -1) {
    if (SYSTEM_ROLES[SYSTEM] && SYSTEM_ROLES[SYSTEM].indexOf(userRole) !== -1 && typeof getHomeForRole === "function") {
      window.location.replace(getHomeForRole(userRole));
      return null;
    }
    await signOutAndGoLogin("wrong_portal", false);
    return null;
  }
  return user;
}

async function dbCreateAccountFromApplication(fullName, email, preferredUsername) {
  var cleanEmail = email.trim().toLowerCase();
  if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
    throw new Error("Customer applications require a valid @gmail.com email address.");
  }
  var code = String(Math.floor(100000 + Math.random() * 900000));

  if (IS_DEMO_MODE) {
    var users = getDemoUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === cleanEmail) {
        if (!users[i].username) {
          users[i].username = await dbGenerateUniqueUsername(fullName, cleanEmail, preferredUsername);
        }
        if (users[i].activated) return { user: users[i], status: "active", code: "" };
        users[i].activation_code = code;
        writeSaved("pigem_users", users);
        return { user: users[i], status: "pending", code: code };
      }
    }
    var demoUsername = await dbGenerateUniqueUsername(fullName, cleanEmail, preferredUsername);
    var newUser = {
      id: "cust-" + Date.now(),
      username: demoUsername,
      email: cleanEmail,
      password: "",
      full_name: fullName,
      role: "customer",
      active: true,
      activated: false,
      activation_code: code
    };
    users.push(newUser);
    writeSaved("pigem_users", users);
    return { user: newUser, status: "new", code: code };
  }

  var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
  if (existing.data && existing.data.activated) {
    return { user: existing.data, status: "active", code: "" };
  }

  var assignedUsername = (existing.data && existing.data.username)
    ? existing.data.username
    : (await dbGenerateUniqueUsername(fullName, cleanEmail, preferredUsername));

  var pendingRow = {
    id: (existing.data && existing.data.id) || ("cust-" + Date.now()),
    username: assignedUsername,
    email: cleanEmail,
    full_name: fullName,
    role: "customer",
    active: true,
    activated: false,
    activation_code: code
  };
  await supabaseClient.from("users").upsert(pendingRow, { onConflict: "email" });
  return { user: pendingRow, status: "new", code: code };
}

async function dbCheckActivationLinkStatus(email, code) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  var cleanCode = String(code || "").trim();
  if (!cleanEmail) {
    return { valid: false, alreadyActivated: false, reason: "Missing customer email in activation link." };
  }
  var record = null;
  if (IS_DEMO_MODE) {
    record = findDemoUserByEmail(cleanEmail);
  } else if (supabaseClient) {
    var res = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
    record = res.data || null;
  }
  if (!record) {
    return { valid: false, alreadyActivated: false, reason: "No pending customer application was found for " + cleanEmail + "." };
  }
  if (record.activated) {
    return {
      valid: false,
      alreadyActivated: true,
      username: record.username || "",
      full_name: record.full_name || "",
      reason: "This one-time activation link has already been used and your account is active. Please sign in on the Customer Login page."
    };
  }
  if (cleanCode && String(record.activation_code || "").trim() !== cleanCode) {
    return {
      valid: false,
      alreadyActivated: false,
      reason: "This activation link or code is no longer valid or has expired."
    };
  }
  return {
    valid: true,
    alreadyActivated: false,
    username: record.username || "",
    full_name: record.full_name || "",
    code: record.activation_code || ""
  };
}

async function dbActivateCustomerAccount(email, code, newPassword, chosenUsername) {
  var cleanEmail = email.trim().toLowerCase();
  if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
    throw new Error("Customer Account activation is for @gmail.com accounts only.");
  }
  var cleanChosenUser = String(chosenUsername || "").trim().toLowerCase();
  if (cleanChosenUser && typeof isValidUsername === "function" && !isValidUsername(cleanChosenUser)) {
    throw new Error("Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
  }

  var pwHash = await hashPassword(newPassword);
  var nowIso = new Date().toISOString();

  if (IS_DEMO_MODE) {
    var users = getDemoUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === cleanEmail) {
        if (users[i].activated) throw new Error("This one-time activation link has already been used. Your account is already active.");
        if (!users[i].activation_code || users[i].activation_code !== code.trim()) {
          throw new Error("The 6-digit activation code is invalid or has already been used.");
        }
        if (cleanChosenUser) {
          if (await dbIsUsernameTaken(cleanChosenUser, users[i].id)) {
            throw new Error("That username is already taken. Please choose another username.");
          }
          users[i].username = cleanChosenUser;
        } else if (!users[i].username) {
          users[i].username = await dbGenerateUniqueUsername(users[i].full_name, cleanEmail);
        }
        users[i].password_hash = pwHash;
        users[i].password_changed_at = nowIso;
        users[i].password_history = [];
        delete users[i].password;
        users[i].activated = true;
        users[i].activation_code = "";
        writeSaved("pigem_users", users);
        await dbBindSingleDeviceSession(users[i]);
        await dbAddLoginHistory(users[i], "account_activated");
        return users[i];
      }
    }
    throw new Error("No application was found for this email.");
  }

  var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
  if (!existing.data) throw new Error("No application was found for this email.");
  if (existing.data.activated) throw new Error("This one-time activation link has already been used. Please log in instead.");
  if (!existing.data.activation_code || String(existing.data.activation_code || "").trim() !== code.trim()) {
    throw new Error("The 6-digit activation code is invalid or has already been used.");
  }

  var finalUsername = existing.data.username || "";
  if (cleanChosenUser) {
    if (await dbIsUsernameTaken(cleanChosenUser, existing.data.id)) {
      throw new Error("That username is already taken. Please choose another username.");
    }
    finalUsername = cleanChosenUser;
  } else if (!finalUsername) {
    finalUsername = await dbGenerateUniqueUsername(existing.data.full_name, cleanEmail);
  }

  var authUserId = existing.data.id;
  try {
    var signUpRes = await supabaseClient.auth.signUp({
      email: cleanEmail,
      password: newPassword,
      options: { data: { full_name: existing.data.full_name, username: finalUsername } }
    });
    if (signUpRes.data && signUpRes.data.user && signUpRes.data.user.id) {
      authUserId = signUpRes.data.user.id;
    }
  } catch (authErr) {}

  var upRes = await supabaseClient.from("users").update({
    id: authUserId,
    username: finalUsername,
    password_hash: pwHash,
    password_changed_at: nowIso,
    password_history: [],
    activated: true,
    activation_code: null
  }).eq("email", cleanEmail).select("*").maybeSingle();

  if (upRes.error) {
    throw new Error(upRes.error.message);
  }

  try {
    await supabaseClient.auth.signInWithPassword({ email: cleanEmail, password: newPassword });
  } catch (e) {}

  var user = (upRes.data) || (await dbGetCurrentUser()) || existing.data;
  if (user) {
    await dbBindSingleDeviceSession(user);
    await dbAddLoginHistory(user, "account_activated");
  }
  return user;
}

async function dbIsAccountActivated(email) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  if (IS_DEMO_MODE) {
    var u = findDemoUserByEmail(cleanEmail);
    return Boolean(u && u.activated);
  }
  var res = await supabaseClient.from("users").select("activated").eq("email", cleanEmail).maybeSingle();
  return Boolean(res.data && res.data.activated);
}

async function dbCreateAgentAccount(fullName, email, password, username) {
  return await dbCreateUserAccount(fullName, email, password, "agent", username);
}

async function dbUpdateMyProfile(userId, changes) {
  return await dbUpdateProfile(userId, changes);
}

async function dbAddLoginHistory(user, action) {
  var row = {
    user_id: user.id,
    username: user.username || null,
    email: user.email || (user.username ? "@" + user.username : ""),
    role: user.role,
    action: action,
    created_at: new Date().toISOString()
  };
  if (IS_DEMO_MODE) {
    var list = readSaved("pigem_login_history", []);
    list.unshift(row);
    writeSaved("pigem_login_history", list.slice(0, 300));
    return;
  }
  await supabaseClient.from("login_history").insert(row);
}

async function dbListLoginHistory() {
  if (IS_DEMO_MODE) return readSaved("pigem_login_history", []);
  var res = await supabaseClient.from("login_history").select("*").order("created_at", { ascending: false }).limit(200);
  return res.data || [];
}

async function dbListApplications(user) {
  if (IS_DEMO_MODE) {
    var all = readSaved("pigem_applications", []);
    if (user && user.role === "customer") {
      return all.filter(function (a) { return a.email === user.email; });
    }
    return all;
  }
  var query = supabaseClient.from("applications").select("*").order("created_at", { ascending: false });
  if (user && user.role === "customer") query = query.eq("email", user.email);
  var res = await query;
  if (res.error) throw new Error(res.error.message);
  return res.data || [];
}

async function dbGetApplication(appId) {
  if (IS_DEMO_MODE) {
    var all = readSaved("pigem_applications", []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === appId) return all[i];
    }
    return null;
  }
  var res = await supabaseClient.from("applications").select("*").eq("id", appId).maybeSingle();
  return res.data;
}

async function dbFindDuplicateCustomerApplication(email, appData) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { isDuplicate: false };
  var existingApps = await dbListApplicationsForCustomer(cleanEmail);
  if (!existingApps || existingApps.length === 0) return { isDuplicate: false };

  var normStr = function (v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  };
  var newAddrKey = normStr((appData.house_no || "") + (appData.street || "") + (appData.barangay || "") + (appData.city || ""));
  var newLat = Number(appData.lat);
  var newLng = Number(appData.lng);
  var hasNewCoords = !isNaN(newLat) && !isNaN(newLng) && newLat !== 0 && newLng !== 0;

  for (var i = 0; i < existingApps.length; i++) {
    var a = existingApps[i];
    if (String(a.status || "") === "Rejected") continue;
    var oldAddrKey = normStr((a.house_no || "") + (a.street || "") + (a.barangay || "") + (a.city || ""));
    var oldLat = Number(a.lat);
    var oldLng = Number(a.lng);
    var sameCoords = hasNewCoords && !isNaN(oldLat) && !isNaN(oldLng) &&
      Math.abs(newLat - oldLat) < 0.00045 && Math.abs(newLng - oldLng) < 0.00045;
    var sameAddress = Boolean(newAddrKey && oldAddrKey && newAddrKey === oldAddrKey);
    var samePersonPlan = normStr(a.full_name) === normStr(appData.full_name) &&
      String(a.plan || a.plan_id || "") === String(appData.plan || appData.plan_id || "");

    if (sameCoords || sameAddress || samePersonPlan) {
      var locText = (typeof formatAddress === "function" ? formatAddress(a) : "") || a.address_line || "the same installation location";
      var reasonDetail = sameCoords || sameAddress
        ? "Duplicate Application at Same Location: This customer account already has an active application (" + a.ref_no + ", Status: " + a.status + ") registered at " + locText + "."
        : "Duplicate Application Under Same Account: This customer account already has an active application (" + a.ref_no + ", Status: " + a.status + ") for the same subscriber and plan.";
      return {
        isDuplicate: true,
        existingApp: a,
        reason: reasonDetail
      };
    }
  }
  return { isDuplicate: false };
}

async function dbDeclineApplicationCorrection(appId, reasonText) {
  var reason = String(reasonText || "").trim() || "Customer chose not to submit the requested correction.";
  var nowIso = new Date().toISOString();
  var app = await dbGetApplication(appId);
  if (!app) throw new Error("Application not found.");
  var updated = await dbUpdateApplication(appId, {
    correction_declined: true,
    correction_declined_reason: reason,
    correction_declined_at: nowIso,
    status: "Rejected",
    customer_instruction: "Application closed because customer chose not to submit the requested correction: " + reason
  });
  await dbAddAiLog(appId, "Customer", "Customer chose not to submit correction (" + reason + "). Application closed.");
  await dbAddNotification({
    role: "agent",
    title: "Customer Declined Correction (" + (app.ref_no || appId) + ")",
    message: (app.full_name || "Customer") + " chose not to proceed with the requested correction on " + (app.ref_no || appId) + ". Reason: " + reason,
    target_tab: "tab-queue",
    target_id: appId
  });
  await dbAddActivity("correction_declined_by_customer", (app.ref_no || appId) + ": " + reason);
  return updated;
}

async function dbCreateApplication(appData) {
  var now = new Date().toISOString();
  var refNo = "PIGEM-" + String(Date.now()).slice(-6) + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  var row = Object.assign({}, appData, {
    ref_no: refNo,
    reference_no: refNo,
    status: appData.status || "Pending Review",
    original_copy: Object.assign({}, appData),
    original_submission: Object.assign({}, appData),
    corrected_copy: null,
    ai_log: [{ at: now, who: "System", text: "Application submitted and queued for document screening." }],
    customer_instruction: appData.customer_instruction || getDefaultStatusInstruction(appData.status || "Processing", appData.provider_remarks || ""),
    created_at: now,
    updated_at: now
  });

  if (IS_DEMO_MODE) {
    row.id = "app-" + Date.now();
    var all = readSaved("pigem_applications", []);
    all.unshift(row);
    writeSaved("pigem_applications", all);
    return row;
  }
  var res = await supabaseClient.from("applications").insert(row).select("*").single();
  if (res.error) throw new Error(res.error.message);
  if (res.data && res.data.id) {
    await dbCreateDocumentRecord(res.data.id, {
      id_type: res.data.id_type || "",
      id_number: res.data.id_number || "",
      front_image_url: res.data.id_image_url || res.data.id_front_path || "",
      back_image_url: res.data.id_back_image_url || res.data.id_back_path || "",
      doc_type: "valid_id",
      file_path: res.data.id_image_url || res.data.id_front_path || "",
      version: "original"
    });
  }
  return res.data;
}

async function dbCreateDocumentRecord(appId, docPayload) {
  if (!appId || IS_DEMO_MODE || !supabaseClient) return null;
  var p = docPayload || {};
  try {
    var docRow = {
      application_id: String(appId),
      id_type: p.id_type || null,
      id_number: p.id_number || null,
      front_image_url: p.front_image_url || null,
      back_image_url: p.back_image_url || null,
      cropped_front_url: p.cropped_front_url || null,
      cropped_back_url: p.cropped_back_url || null,
      doc_type: p.doc_type || "valid_id",
      file_path: p.file_path || p.front_image_url || null,
      version: p.version || "original"
    };
    var docRes = await supabaseClient.from("documents").insert(docRow).select("*").maybeSingle();
    return docRes.data || null;
  } catch (e) {
    return null;
  }
}

async function dbUpdateApplication(appId, changes) {
  changes.updated_at = new Date().toISOString();
  if (IS_DEMO_MODE) {
    var all = readSaved("pigem_applications", []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === appId) {
        all[i] = Object.assign({}, all[i], changes);
        writeSaved("pigem_applications", all);
        return all[i];
      }
    }
    throw new Error("Application not found.");
  }
  var res = await supabaseClient.from("applications").update(changes).eq("id", appId).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function dbAddAiLog(appId, who, text) {
  var app = await dbGetApplication(appId);
  if (!app) return;
  var log = app.ai_log || [];
  log.push({ at: new Date().toISOString(), who: who, text: text });
  await dbUpdateApplication(appId, { ai_log: log });
}

async function dbUploadDocument(file, folder, label) {
  if (!file) return null;
  var cleanFolder = String(folder || "applications/uploads").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_/-]/g, "_");
  var cleanLabel = String(label || "doc").replace(/[^a-zA-Z0-9_-]/g, "_");
  var ext = ((file.name && file.name.split(".").pop()) || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  var fileName = Date.now() + "-" + cleanLabel + "." + ext;
  var path = cleanFolder + "/" + fileName;

  if (!IS_DEMO_MODE && supabaseClient && supabaseClient.storage) {
    try {
      var res = await supabaseClient.storage.from("documents").upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/jpeg"
      });
      if (!res.error) {
        var pub = supabaseClient.storage.from("documents").getPublicUrl(path);
        if (pub && pub.data && pub.data.publicUrl) {
          return pub.data.publicUrl;
        }
      } else {
        console.warn("Supabase documents storage upload failed:", res.error.message);
      }
    } catch (storageErr) {
      console.warn("Direct storage upload notice, utilizing encoded fallback:", storageErr);
    }
  }

  return await new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function dbGetDocumentLink(path) {
  if (!path) return null;
  if (path.indexOf("data:") === 0 || path.indexOf("http") === 0 || IS_DEMO_MODE) return path;
  var res = await supabaseClient.storage.from("documents").createSignedUrl(path, 600);
  return res.error ? null : res.data.signedUrl;
}

async function dbAddNotification(note, roleArg, titleArg, messageArg) {
  var payload = (note && typeof note === "object") ? note : {
    email: typeof note === "string" ? note : null,
    role: roleArg || null,
    title: titleArg || "Notification",
    message: messageArg || ""
  };
  var row = {
    user_id: payload.user_id || null,
    email: payload.email ? String(payload.email).trim().toLowerCase() : null,
    role: payload.role || null,
    title: payload.title || payload.subject || "Notification",
    message: payload.message || payload.body || "",
    target_tab: payload.target_tab || null,
    target_id: payload.target_id || null,
    is_read: false,
    created_at: new Date().toISOString()
  };
  if (IS_DEMO_MODE) {
    row.id = Date.now() + Math.floor(Math.random() * 1000);
    var all = readSaved("pigem_notifications", []);
    all.unshift(row);
    writeSaved("pigem_notifications", all.slice(0, 300));
    return row;
  }
  await supabaseClient.from("notifications").insert(row);
}

async function dbListMyNotifications(user) {
  if (!user) return [];
  var isCustomer = String(user.role || "") === "customer";
  var userEmail = String(user.email || "").trim().toLowerCase();
  if (IS_DEMO_MODE) {
    return readSaved("pigem_notifications", []).filter(function (n) {
      if (isCustomer) {
        return (user.id && n.user_id && n.user_id === user.id) ||
          (userEmail && n.email && String(n.email).trim().toLowerCase() === userEmail);
      }
      return (n.user_id && n.user_id === user.id) ||
        (userEmail && n.email && String(n.email).trim().toLowerCase() === userEmail) ||
        (n.role && n.role === user.role);
    });
  }
  var orParts = [];
  if (user.id) orParts.push("user_id.eq." + user.id);
  if (userEmail) orParts.push("email.eq." + userEmail);
  if (!isCustomer && user.role) orParts.push("role.eq." + user.role);
  if (orParts.length === 0) return [];
  var res = await supabaseClient.from("notifications").select("*")
    .or(orParts.join(","))
    .order("created_at", { ascending: false }).limit(50);
  var rows = res.data || [];
  if (isCustomer) {
    rows = rows.filter(function (n) {
      var nEmail = String(n.email || "").trim().toLowerCase();
      return (user.id && n.user_id === user.id) || (userEmail && nEmail === userEmail);
    });
  }
  return rows;
}

async function dbAddActivity(action, detail) {
  var user = await dbGetCurrentUser();
  var row = {
    actor_username: user && user.username ? user.username : null,
    actor_email: user ? (user.email || (user.username ? "@" + user.username : "staff")) : "public",
    action: action,
    detail: String(detail || ""),
    created_at: new Date().toISOString()
  };
  if (IS_DEMO_MODE) {
    var all = readSaved("pigem_activity", []);
    all.unshift(row);
    writeSaved("pigem_activity", all.slice(0, 300));
    return;
  }
  await supabaseClient.from("system_logs").insert(row);
}

async function dbListActivity() {
  if (IS_DEMO_MODE) return readSaved("pigem_activity", []);
  var res = await supabaseClient.from("system_logs").select("*").order("created_at", { ascending: false }).limit(200);
  return res.data || [];
}

async function dbListProfiles() {
  if (IS_DEMO_MODE) return getDemoUsers();
  var res = await supabaseClient.from("users").select("*").order("created_at", { ascending: false });
  return res.data || [];
}

async function dbUpdateProfile(userId, changes) {
  var safeChanges = Object.assign({}, changes || {});
  if (safeChanges.active === false) {
    if (!IS_DEMO_MODE && supabaseClient) {
      var chkAdm = await supabaseClient.from("users").select("role").eq("id", userId).maybeSingle();
      if (chkAdm.data && chkAdm.data.role === "admin") {
        throw new Error("The primary System Administrator account cannot be disabled.");
      }
    } else {
      var localTarget = getDemoUsers().find(function (x) { return x.id === userId; });
      if (localTarget && localTarget.role === "admin") {
        throw new Error("The primary System Administrator account cannot be disabled.");
      }
    }
    safeChanges.session_token = null;
  }
  if (safeChanges.username != null) {
    var cleanUser = String(safeChanges.username || "").trim().toLowerCase();
    if (typeof isValidUsername === "function" && !isValidUsername(cleanUser)) {
      throw new Error("Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
    }
    if (await dbIsUsernameTaken(cleanUser, userId)) {
      throw new Error("Username '@" + cleanUser + "' is already taken. Please choose another username.");
    }
    safeChanges.username = cleanUser;
  }

  var users = getDemoUsers();
  var localUpdated = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      users[i] = Object.assign({}, users[i], safeChanges);
      localUpdated = users[i];
      writeSaved("pigem_users", users);
      break;
    }
  }

  if (IS_DEMO_MODE) {
    return localUpdated;
  }
  var res = await supabaseClient.from("users").update(safeChanges).eq("id", userId).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function dbResetDemoData() {
  var keys = ["pigem_users", "pigem_applications", "pigem_notifications", "pigem_activity", "pigem_login_history",
    "pigem_provider_updates", "pigem_plans", "pigem_website_content", "pigem_system_settings",
    "pigem_session_customer", "pigem_session_customer_tok",
    "pigem_session_staff", "pigem_session_staff_tok",
    "pigem_session_admin", "pigem_session_admin_tok"];
  for (var i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
  sessionStorage.clear();
}

var DEFAULT_DEMO_APPS = [
  {
    id: "app-demo-1",
    ref_no: "PIGEM-842190-A1B2",
    reference_no: "PIGEM-842190-A1B2",
    plan_id: "1400",
    plan_name: "Plan 1400 (300 Mbps - ₱1,400/mo)",
    first_name: "Juan",
    middle_name: "Santos",
    last_name: "Dela Cruz",
    full_name: "Juan Santos Dela Cruz",
    email: "customer@demo.test",
    birth_date: "1995-04-12",
    phone: "09171234567",
    id_type: "Philippine Driver's License",
    id_number: "N01-23-456789",
    id_image_url: "https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/black-logo-white-mode.png",
    building_name: "Greenwoods Subd.",
    street: "Blk 4 Lot 12 Sampaguita St.",
    subdivision: "Greenwoods Executive",
    barangay: "Salitran II",
    city: "Dasmariñas City",
    province: "Cavite",
    landmark: "Near Salitran Elementary School",
    latitude: 14.3294,
    longitude: 120.9367,
    status: "Pending Review",
    assigned_agent: "",
    encoded: false,
    has_correction: false,
    ai_result: {
      overall_status: "Verified",
      blur_score: 142.5,
      name_match: true,
      id_number_match: true,
      issues: []
    },
    ai_log: [
      { at: new Date(Date.now() - 7200000).toISOString(), who: "Application Screening", text: "Document screening passed: ID image is clear and entered details match." }
    ],
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: "app-demo-2",
    ref_no: "PIGEM-739104-C3D4",
    reference_no: "PIGEM-739104-C3D4",
    plan_id: "1000",
    plan_name: "Plan 1000 (100 Mbps - ₱1,000/mo)",
    first_name: "Maria",
    middle_name: "L.",
    last_name: "Reyes",
    full_name: "Maria L. Reyes",
    email: "customer@demo.test",
    birth_date: "1998-09-21",
    phone: "09189876543",
    id_type: "National ID",
    id_number: "1234-5678-9012-3456",
    id_image_url: "https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/black-logo-white-mode.png",
    building_name: "Villa Luisa",
    street: "24 Mabini St.",
    subdivision: "Villa Luisa Homes",
    barangay: "Zone IV",
    city: "Dasmariñas City",
    province: "Cavite",
    landmark: "Beside Barangay Hall",
    latitude: 14.3270,
    longitude: 120.9380,
    status: "Needs Correction",
    assigned_agent: "agent@demo.test",
    agent_remarks: "Please upload a clearer photo of your National ID (glare on the ID number).",
    encoded: false,
    has_correction: false,
    ai_result: {
      overall_status: "Needs Review",
      blur_score: 48.2,
      name_match: true,
      id_number_match: false,
      issues: ["Slight glare detected on ID number area"]
    },
    ai_log: [
      { at: new Date(Date.now() - 18000000).toISOString(), who: "Application Screening", text: "Flagged slight glare on the ID number area." },
      { at: new Date(Date.now() - 14400000).toISOString(), who: "Agent (Alex Rivera)", text: "Requested clearer ID photo from customer." }
    ],
    created_at: new Date(Date.now() - 18000000).toISOString(),
    updated_at: new Date(Date.now() - 14400000).toISOString()
  },
  {
    id: "app-demo-3",
    ref_no: "PIGEM-615022-E5F6",
    reference_no: "PIGEM-615022-E5F6",
    plan_id: "1900",
    plan_name: "Plan 1900 (500 Mbps - ₱1,900/mo)",
    first_name: "Carlo",
    middle_name: "M.",
    last_name: "Bautista",
    full_name: "Carlo M. Bautista",
    email: "carlo@demo.test",
    birth_date: "1990-01-15",
    phone: "09223334455",
    id_type: "Philippine Passport",
    id_number: "P1234567A",
    id_image_url: "https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/black-logo-white-mode.png",
    building_name: "St. Charbel",
    street: "88 Aguinaldo Hwy",
    subdivision: "St. Charbel South",
    barangay: "Sampaloc I",
    city: "Dasmariñas City",
    province: "Cavite",
    landmark: "Across Robinsons Place Dasmariñas",
    latitude: 14.3035,
    longitude: 120.9560,
    status: "Approved",
    assigned_agent: "agent@demo.test",
    agent_remarks: "Application verified and encoded. Please wait 3-5 business days for installation dispatch.",
    encoded: true,
    has_correction: true,
    original_submission: {
      full_name: "Carlo Bautista",
      phone: "09220001111",
      id_type: "Philippine Passport",
      id_number: "P1234567",
      street: "Aguinaldo Hwy",
      id_image_url: "https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/black-logo-white-mode.png"
    },
    ai_result: {
      overall_status: "Verified",
      blur_score: 165.0,
      name_match: true,
      id_number_match: true,
      issues: []
    },
    ai_log: [
      { at: new Date(Date.now() - 86400000).toISOString(), who: "Customer (Carlo M. Bautista)", text: "Resubmitted corrected passport number P1234567A." },
      { at: new Date(Date.now() - 82800000).toISOString(), who: "Agent (Alex Rivera)", text: "Verified corrected copy and encoded to Red Fiber provider." }
    ],
    created_at: new Date(Date.now() - 90000000).toISOString(),
    updated_at: new Date(Date.now() - 82800000).toISOString()
  }
];

function normalizeAppRecord(a) {
  if (!a) return a;
  if (!a.reference_no && a.ref_no) a.reference_no = a.ref_no;
  if (!a.ref_no && a.reference_no) a.ref_no = a.reference_no;
  if (!a.plan_id && a.plan) a.plan_id = a.plan;
  if (!a.plan_name && a.plan_id) {
    var p = getPlanById(a.plan_id);
    a.plan_name = p.name + " (" + p.speed + " Mbps - ₱" + p.price + "/mo)";
  }
  if (!a.full_name) {
    a.full_name = ((a.first_name || "") + " " + (a.middle_name ? a.middle_name + " " : "") + (a.last_name || "")).trim() || a.email || "Applicant";
  }
  if (!a.phone && a.mobile_primary) a.phone = a.mobile_primary;
  if (!a.id_image_url) a.id_image_url = a.id_front_path || a.id_front_url || "";
  if (a.latitude == null && a.lat != null) a.latitude = a.lat;
  if (a.longitude == null && a.lng != null) a.longitude = a.lng;
  if (a.screening && typeof a.screening === "object") {
    a.cropped_id_url = a.cropped_id_url || a.id_cropped_url || a.cropped_id_path || a.screening.cropped_front_url || a.screening.cropped_id_url || (a.ai_result && (a.ai_result.cropped_front_url || a.ai_result.cropped_id_url)) || "";
    a.cropped_back_url = a.cropped_back_url || a.id_back_cropped_url || a.screening.cropped_back_url || "";
    var q = a.screening.quality || {};
    var ai = a.screening.ai || {};
    var comps = Array.isArray(a.screening.comparisons) ? a.screening.comparisons : [];
    var nMatch = true, bMatch = true, idMatch = true;
    for (var ci = 0; ci < comps.length; ci++) {
      var ck = String(comps[ci].key || comps[ci].field || "").toLowerCase();
      if (comps[ci].result === "mismatch") {
        if (ck.indexOf("name") !== -1) nMatch = false;
        else if (ck.indexOf("birth") !== -1) bMatch = false;
        else if (ck.indexOf("id") !== -1) idMatch = false;
      }
    }
    if (!a.ai_result || a.screening.state) {
      var findingsList = a.screening.findings || (ai.findings && ai.findings.length ? ai.findings : (q.issues || []));
      a.ai_result = Object.assign({}, a.ai_result || {}, {
        overall_status: (a.ai_result && a.ai_result.overall_status) || ((findingsList.length > 0 && (!nMatch || !idMatch || !bMatch || (q.issues && q.issues.length > 0))) ? "Needs Review" : "Verified"),
        blur_score: q.blur_score != null ? q.blur_score : ((a.ai_result && a.ai_result.blur_score) || "OK"),
        name_match: (a.ai_result && a.ai_result.name_match != null) ? a.ai_result.name_match : nMatch,
        birth_date_match: (a.ai_result && a.ai_result.birth_date_match != null) ? a.ai_result.birth_date_match : bMatch,
        id_number_match: (a.ai_result && a.ai_result.id_number_match != null) ? a.ai_result.id_number_match : idMatch,
        cropped_id_url: a.cropped_id_url,
        issues: findingsList
      });
    }
  }
  if (!a.original_submission && a.original_copy) a.original_submission = a.original_copy;
  if (!a.correction_fields && a.screening && a.screening.correction_fields) {
    a.correction_fields = a.screening.correction_fields;
  }
  if (!a.validator_raw_remark && a.screening && a.screening.validator_raw_remark) {
    a.validator_raw_remark = a.screening.validator_raw_remark;
  }
  if (!a.agent_remarks && (a.correction_note || a.customer_instruction)) {
    a.agent_remarks = a.correction_note || a.customer_instruction;
  }
  if (a.status === "Processing") a.status = "Pending Review";
  return a;
}

function ensureDemoSeedApps() {
  var apps = readSaved("pigem_applications", null);
  if (!apps || apps.length === 0) {
    writeSaved("pigem_applications", DEFAULT_DEMO_APPS);
    return DEFAULT_DEMO_APPS.slice();
  }
  for (var i = 0; i < apps.length; i++) normalizeAppRecord(apps[i]);
  return apps;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showMsg(id, type, text) {
  var el = document.getElementById(id);
  if (!el) return;
  el.className = "msg show " + (type || "info");
  el.textContent = text;
}

function hideMsg(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.className = "msg";
  el.textContent = "";
}

function statusBadge(status) {
  var st = status || "Pending Review";
  var cls = "badge-gray";
  if (st === "Approved" || st === "Submitted to Provider") cls = "badge-green";
  else if (st === "Encoding") cls = "badge-blue";
  else if (st === "Needs Correction") cls = "badge-yellow";
  else if (st === "Rejected") cls = "badge-red";
  else if (st === "Under Agent Review" || st === "Pending Review" || st === "Processing") cls = "badge-blue";
  return '<span class="badge ' + cls + '">' + escapeHtml(st) + '</span>';
}

function getCustomerStatus(rawStatus) {
  if (rawStatus === "Approved") return "Approved";
  if (rawStatus === "Rejected") return "Rejected";
  return "Processing";
}

function customerStatusBadge(rawStatus) {
  var vis = getCustomerStatus(rawStatus);
  var cls = vis === "Approved" ? "badge-green" : (vis === "Rejected" ? "badge-red" : "badge-blue");
  var html = '<span class="badge ' + cls + '">' + escapeHtml(vis) + '</span>';
  if (rawStatus === "Needs Correction") {
    html += ' <span class="badge badge-yellow">Needs Correction</span>';
  }
  return html;
}

function isAiEnabled() {
  return Boolean(getSystemSettings().ai_enabled);
}

function setAiEnabled(val) {
  var s = getSystemSettings();
  s.ai_enabled = Boolean(val);
  saveSystemSettings(s);
}

function isMaintenanceOn() {
  return Boolean(getSystemSettings().maintenance_mode);
}

function setMaintenanceOn(val) {
  var s = getSystemSettings();
  s.maintenance_mode = Boolean(val);
  saveSystemSettings(s);
}

function getSiteContent() {
  var wc = getWebsiteContent();
  var plans = getActivePlans();
  return {
    logo_image: wc.logo_image || DEFAULT_CONTENT.logo_image || "black-logo-white-mode.png",
    dark_logo_image: wc.dark_logo_image || DEFAULT_CONTENT.dark_logo_image || "white-logo-dark-mode.png",
    hero_slide_count: Number(wc.hero_slide_count || DEFAULT_CONTENT.hero_slide_count || 3),
    home_slides: wc.hero_slides || DEFAULT_CONTENT.hero_slides,
    about_slides: wc.about_slides || DEFAULT_CONTENT.about_slides,
    client_images: wc.client_images || DEFAULT_CONTENT.client_images,
    vehicle_images: wc.vehicle_images || DEFAULT_CONTENT.vehicle_images,
    permit_images: wc.permit_images || DEFAULT_CONTENT.permit_images,
    asset_library: wc.asset_library || DEFAULT_CONTENT.asset_library,
    about_lead: (wc.about && wc.about.mission) || DEFAULT_CONTENT.about.mission,
    about_story_1: (wc.about && wc.about.story) || DEFAULT_CONTENT.about.story,
    about_story_2: (wc.about && wc.about.story2) || DEFAULT_CONTENT.about.story2,
    contact_email: wc.contact_email || "",
    contact_phone: wc.contact_phone || "101-733 (RED) / (02) 8899-9733",
    contact_address: wc.contact_address || "Dasmariñas City, Cavite",
    announcement: wc.announcement || { active: false, headline: "", body: "" },
    plans: plans.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        speed: String(p.speed).indexOf("Mbps") !== -1 ? p.speed : (p.speed + " Mbps"),
        price: p.price,
        features: p.features || CONFIG.PLAN_INCLUSIONS
      };
    }),
    faqs: wc.faqs || DEFAULT_CONTENT.faqs
  };
}

function saveSiteContent(c) {
  var wc = getWebsiteContent();
  if (c.logo_image) wc.logo_image = c.logo_image;
  if (c.dark_logo_image) wc.dark_logo_image = c.dark_logo_image;
  if (c.hero_slide_count != null) wc.hero_slide_count = Number(c.hero_slide_count) || 3;
  if (c.home_slides) wc.hero_slides = c.home_slides;
  if (c.about_slides) wc.about_slides = c.about_slides;
  if (c.client_images) wc.client_images = c.client_images;
  if (c.vehicle_images) wc.vehicle_images = c.vehicle_images;
  if (c.permit_images) wc.permit_images = c.permit_images;
  if (c.asset_library) wc.asset_library = c.asset_library;
  wc.about = wc.about || {};
  if (c.about_lead != null) wc.about.mission = c.about_lead;
  if (c.about_story_1 != null) wc.about.story = c.about_story_1;
  if (c.about_story_2 != null) wc.about.story2 = c.about_story_2;
  if (c.contact_email != null) wc.contact_email = c.contact_email;
  if (c.contact_phone != null) wc.contact_phone = c.contact_phone;
  if (c.contact_address != null) wc.contact_address = c.contact_address;
  if (c.announcement != null) wc.announcement = c.announcement;
  if (c.faqs) wc.faqs = c.faqs;
  saveWebsiteContent(wc);

  if (c.plans) {
    var mapped = c.plans.map(function (p, idx) {
      var numSpeed = parseInt(String(p.speed).replace(/[^0-9]/g, ""), 10) || 100;
      return {
        id: p.id || String(p.price || (idx === 0 ? "1000" : idx === 1 ? "1400" : "1900")),
        name: p.name,
        speed: numSpeed,
        price: p.price,
        tag: idx === 1 ? "Most chosen" : "Fiber for your home",
        featured: idx === 1,
        features: p.features
      };
    });
    saveActivePlans(mapped);
  }
}

async function requireLogin(roles) {
  return await checkPageAccess(roles);
}

async function signOutAndGoLogin(reasonCode, clearServerToken) {
  var page = getLoginPage();
  await dbSignOut(clearServerToken);
  if (reasonCode) {
    page += (page.indexOf("?") === -1 ? "?" : "&") + "reason=" + encodeURIComponent(reasonCode);
  }
  window.location.replace(page);
}

function maskEmailAddress(email) {
  var clean = String(email || "").trim().toLowerCase();
  if (clean.indexOf("@") === -1) return "******@gmail.com";
  var parts = clean.split("@");
  var local = parts[0];
  var domain = parts[1];
  var tail = local.length >= 2 ? local.slice(-2) : local;
  return "******" + tail + "@" + domain;
}

function maskPhoneNumber(phone) {
  var digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "09********00";
  var prefix = digits.slice(0, 2) || "09";
  var suffix = digits.slice(-2);
  return prefix + "********" + suffix;
}

function generateSecuredOtp(targetKey) {
  var key = "pigem_otp_" + String(targetKey || "default").toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
  var randArr = new Uint32Array(1);
  if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(randArr);
  } else {
    randArr[0] = Math.floor(Math.random() * 900000) + 100000;
  }
  var code = String(100000 + (randArr[0] % 900000));
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var refTag = "";
  for (var i = 0; i < 4; i++) {
    refTag += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var record = {
    code: code,
    refTag: refTag,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000,
    used: false
  };
  sessionStorage.setItem(key, JSON.stringify(record));
  return record;
}

function verifySecuredOtp(targetKey, enteredCode) {
  var key = "pigem_otp_" + String(targetKey || "default").toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
  var raw = sessionStorage.getItem(key);
  if (!raw) {
    return { valid: false, reason: "No active OTP found. Please request a new OTP code." };
  }
  try {
    var rec = JSON.parse(raw);
    if (rec.used) {
      return { valid: false, reason: "This OTP has already been used. Please request a new code." };
    }
    if (Date.now() > Number(rec.expiresAt || 0)) {
      sessionStorage.removeItem(key);
      return { valid: false, reason: "This OTP code has expired (valid for 5 minutes). Please click Resend OTP." };
    }
    if (String(rec.code) !== String(enteredCode || "").trim()) {
      return { valid: false, reason: "The 6-digit verification code is incorrect." };
    }
    rec.used = true;
    sessionStorage.setItem(key, JSON.stringify(rec));
    return { valid: true, refTag: rec.refTag };
  } catch (e) {
    return { valid: false, reason: "Could not verify OTP code." };
  }
}

async function dbFindAccountForRecovery(queryValue, recoveryMode) {
  var q = String(queryValue || "").trim();
  if (!q) throw new Error("Please enter the required account detail.");
  var qLower = q.toLowerCase();

  var matchedUser = null;
  var matchedApp = null;

  var localUsers = getDemoUsers();
  for (var i = 0; i < localUsers.length; i++) {
    var u = localUsers[i];
    if (
      String(u.email || "").toLowerCase() === qLower ||
      String(u.username || "").toLowerCase() === qLower ||
      String(u.full_name || "").toLowerCase() === qLower
    ) {
      matchedUser = u;
      break;
    }
  }

  if (!IS_DEMO_MODE && supabaseClient) {
    if (qLower.indexOf("@") !== -1) {
      var uRes = await supabaseClient.from("users").select("*").eq("email", qLower).maybeSingle();
      if (uRes.data) matchedUser = uRes.data;
      var aRes = await supabaseClient.from("applications").select("*").eq("email", qLower).order("created_at", { ascending: false }).limit(1);
      if (aRes.data && aRes.data.length > 0) matchedApp = aRes.data[0];
    } else {
      var unRes = await supabaseClient.from("users").select("*").ilike("username", qLower).maybeSingle();
      if (unRes.data) matchedUser = unRes.data;
      if (!matchedUser) {
        var refRes = await supabaseClient.from("applications").select("*").ilike("ref_no", qLower).limit(1);
        if (refRes.data && refRes.data.length > 0) {
          matchedApp = refRes.data[0];
          var ueRes = await supabaseClient.from("users").select("*").eq("email", String(matchedApp.email || "").toLowerCase()).maybeSingle();
          if (ueRes.data) matchedUser = ueRes.data;
        }
      }
      if (!matchedUser) {
        var fnRes = await supabaseClient.from("users").select("*").ilike("full_name", qLower).limit(1);
        if (fnRes.data && fnRes.data.length > 0) matchedUser = fnRes.data[0];
      }
      if (matchedUser && matchedUser.email && !matchedApp) {
        var appByE = await supabaseClient.from("applications").select("*").eq("email", matchedUser.email).order("created_at", { ascending: false }).limit(1);
        if (appByE.data && appByE.data.length > 0) matchedApp = appByE.data[0];
      }
    }
  }

  if (!matchedUser && !matchedApp) {
    var allApps = await dbListAllApplications();
    for (var j = 0; j < allApps.length; j++) {
      var a = allApps[j];
      if (
        String(a.email || "").toLowerCase() === qLower ||
        String(a.full_name || "").toLowerCase() === qLower ||
        String(a.ref_no || "").toLowerCase() === qLower
      ) {
        matchedApp = a;
        break;
      }
    }
  }

  if (!matchedUser && !matchedApp) {
    throw new Error("No account was found matching that information.");
  }

  var email = String((matchedUser && matchedUser.email) || (matchedApp && matchedApp.email) || "").toLowerCase();
  if (matchedUser && matchedUser.role && matchedUser.role !== "customer") {
    throw new Error("Internal staff credentials are managed by the System Administrator.");
  }

  var fullName = (matchedUser && matchedUser.full_name) || (matchedApp && matchedApp.full_name) || "Valued Subscriber";
  var username = (matchedUser && matchedUser.username) || (await dbGetSuggestedUsername(email));
  var phone = (matchedApp && matchedApp.phone) || "09170000021";

  var otpRec = generateSecuredOtp("recovery_" + email);
  if (!IS_DEMO_MODE && supabaseClient && email) {
    if (matchedUser) {
      await supabaseClient.from("users").update({ activation_code: otpRec.code }).eq("email", email);
    } else {
      await supabaseClient.from("users").upsert({
        id: "cust-" + Date.now(),
        username: username,
        email: email,
        full_name: fullName,
        role: "customer",
        active: true,
        activated: true,
        activation_code: otpRec.code
      }, { onConflict: "email" });
    }
  }

  var users = getDemoUsers();
  for (var k = 0; k < users.length; k++) {
    if (users[k].email === email) {
      users[k].reset_code = otpRec.code;
      writeSaved("pigem_users", users);
      break;
    }
  }

  return {
    email: email,
    username: username,
    fullName: fullName,
    phone: phone,
    maskedEmail: maskEmailAddress(email),
    maskedPhone: maskPhoneNumber(phone),
    code: otpRec.code,
    refTag: otpRec.refTag,
    expiresAt: otpRec.expiresAt,
    mode: recoveryMode || "password"
  };
}

async function dbStartPasswordReset(email) {
  var info = await dbFindAccountForRecovery(email, "password");
  return info.code;
}

async function dbFinishPasswordReset(email, code, newPw) {
  if (!newPw || newPw.length < 8) throw new Error("Password must be at least 8 characters.");
  var clean = String(email || "").trim().toLowerCase();
  var cleanCode = String(code || "").trim();
  var pwHash = await hashPassword(newPw);
  var nowIso = new Date().toISOString();
  var users = getDemoUsers();
  var updatedLocal = false;

  for (var i = 0; i < users.length; i++) {
    if (users[i].email === clean) {
      if (users[i].reset_code && users[i].reset_code !== cleanCode) {
        throw new Error("Invalid 6-digit verification code.");
      }
      var localReuse = checkPasswordHistoryReuse(users[i], pwHash);
      if (localReuse.reused) throw new Error(localReuse.message);
      users[i].password_history = buildNextPasswordHistory(users[i]);
      users[i].password_hash = pwHash;
      users[i].password_changed_at = nowIso;
      delete users[i].password;
      users[i].activated = true;
      users[i].activation_code = "";
      users[i].reset_code = "";
      writeSaved("pigem_users", users);
      updatedLocal = true;
      break;
    }
  }

  if (!IS_DEMO_MODE) {
    var existing = await supabaseClient.from("users").select("*").eq("email", clean).maybeSingle();
    if (existing.data) {
      if (!updatedLocal && String(existing.data.activation_code || "").trim() !== cleanCode) {
        throw new Error("Invalid 6-digit verification code.");
      }
      var dbReuse = checkPasswordHistoryReuse(existing.data, pwHash);
      if (dbReuse.reused) throw new Error(dbReuse.message);
      var nextHist = buildNextPasswordHistory(existing.data);
      await supabaseClient.from("users").update({
        activated: true,
        password_hash: pwHash,
        password_changed_at: nowIso,
        password_history: nextHist,
        activation_code: null
      }).eq("email", clean);

      if (!updatedLocal) {
        users.push({
          id: existing.data.id,
          username: existing.data.username || (await dbGenerateUniqueUsername(existing.data.full_name || clean, clean)),
          email: clean,
          password_hash: pwHash,
          password_changed_at: nowIso,
          password_history: nextHist,
          full_name: existing.data.full_name || clean,
          role: existing.data.role || "customer",
          active: existing.data.active !== false,
          activated: true
        });
        writeSaved("pigem_users", users);
      }
      return true;
    }
  }

  if (updatedLocal) return true;
  throw new Error("Account not found.");
}

async function dbListAllApplications() {
  if (IS_DEMO_MODE) {
    return ensureDemoSeedApps();
  }
  var list = await dbListApplications(null);
  return list.map(normalizeAppRecord);
}

async function dbListApplicationsForCustomer(email) {
  var all = await dbListAllApplications();
  var clean = String(email || "").trim().toLowerCase();
  return all.filter(function (a) { return String(a.email || "").toLowerCase() === clean; });
}

async function dbUploadIdPhoto(file, label, customerId) {
  var safeOwner = String(customerId || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
  return await dbUploadDocument(file, "applications/" + safeOwner + "/corrections", label || "id-update");
}

async function dbListNotifications(email, role) {
  var u = await dbGetCurrentUser();
  var list = await dbListMyNotifications(u || { id: "", email: email, role: role });
  return list.map(function (n) {
    return {
      id: n.id,
      title: n.title || n.subject || "Notification",
      message: n.message || n.body || "",
      target_tab: n.target_tab || null,
      target_id: n.target_id || null,
      created_at: n.created_at
    };
  });
}

var _origDbAddNotification = dbAddNotification;
dbAddNotification = async function (arg1, arg2, arg3, arg4) {
  if (typeof arg1 === "object" && arg1 !== null) {
    return await _origDbAddNotification(arg1);
  }
  return await _origDbAddNotification({
    email: arg1,
    role: arg2,
    subject: arg3,
    body: arg4
  });
};

var _origDbAddAiLog = dbAddAiLog;
dbAddAiLog = async function (appId, arg2, arg3, arg4) {
  var who = arg4 !== undefined ? arg3 : arg2;
  var text = arg4 !== undefined ? arg4 : arg3;
  var refNo = arg4 !== undefined ? arg2 : "";
  await _origDbAddAiLog(appId, who, text);
  var globalAi = readSaved("pigem_ai_logs", []);
  globalAi.unshift({
    app_id: appId,
    reference_no: refNo,
    actor: who,
    message: text,
    created_at: new Date().toISOString()
  });
  writeSaved("pigem_ai_logs", globalAi.slice(0, 200));
};

async function dbListAiLogs(appId) {
  if (appId) {
    var app = await dbGetApplication(appId);
    if (!app || !app.ai_log) return [];
    return app.ai_log.map(function (item) {
      return {
        actor: item.who || item.actor || "System",
        message: item.text || item.message || "",
        created_at: item.at || item.created_at
      };
    });
  }
  var all = await dbListAllApplications();
  var merged = [];
  for (var i = 0; i < all.length; i++) {
    var logs = all[i].ai_log || [];
    for (var j = 0; j < logs.length; j++) {
      merged.push({
        reference_no: all[i].reference_no || all[i].ref_no,
        actor: logs[j].who || "Application Screening",
        message: logs[j].text || "",
        created_at: logs[j].at || all[i].created_at
      });
    }
  }
  return merged;
}

async function dbAddLog(actorEmail, actionText) {
  await dbAddActivity(actionText, actorEmail);
}

async function dbListLogs() {
  var list = await dbListActivity();
  return list.map(function (r) {
    return {
      created_at: r.created_at,
      actor_username: r.actor_username || "",
      actor_email: r.actor_email || "system",
      action: r.action + (r.detail ? " (" + r.detail + ")" : "")
    };
  });
}

async function dbRecordProviderUpdate(appId, providerRef, providerStatus, providerRemark, customerInstruction) {
  if (!appId || !providerStatus) return null;
  var currentUser = await dbGetCurrentUser();
  var row = {
    application_id: appId,
    recorded_by: currentUser && currentUser.id ? currentUser.id : null,
    provider_ref: providerRef || null,
    provider_status: providerStatus,
    provider_remark: providerRemark || null,
    customer_instruction: customerInstruction || null,
    created_at: new Date().toISOString()
  };

  if (IS_DEMO_MODE) {
    var list = readSaved("pigem_provider_updates", []);
    list.unshift(row);
    writeSaved("pigem_provider_updates", list.slice(0, 300));
    return row;
  }

  if (supabaseClient) {
    try {
      await supabaseClient.from("provider_updates").insert(row);
    } catch (e) {}
  }
  return row;
}

async function dbListProviderUpdates(appId) {
  if (IS_DEMO_MODE) {
    var all = readSaved("pigem_provider_updates", []);
    return appId ? all.filter(function (r) { return r.application_id === appId; }) : all;
  }
  if (!supabaseClient) return [];
  var query = supabaseClient.from("provider_updates").select("*").order("created_at", { ascending: false });
  if (appId) query = query.eq("application_id", appId);
  var res = await query.limit(100);
  return res.data || [];
}

async function dbCreateAgentLink(agentEmail, note) {
  var code = "REF-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  var item = {
    code: code,
    agent_email: agentEmail,
    note: note || "",
    active: true,
    created_at: new Date().toISOString()
  };
  var list = readSaved("pigem_agent_links", []);
  list.unshift(item);
  writeSaved("pigem_agent_links", list);
  if (!IS_DEMO_MODE && supabaseClient) {
    await supabaseClient.from("agent_links").upsert(item, { onConflict: "code" });
  }
  return item;
}

async function dbCreateAgentInviteLink(creatorRef, note) {
  var randPart = Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  var code = "INV-" + randPart;
  var item = {
    code: code,
    agent_email: creatorRef || "@manager",
    note: note || "Private One-Time Agent Registration Link",
    active: true,
    created_at: new Date().toISOString()
  };
  var list = readSaved("pigem_agent_links", []);
  list.unshift(item);
  writeSaved("pigem_agent_links", list);
  if (!IS_DEMO_MODE && supabaseClient) {
    await supabaseClient.from("agent_links").upsert(item, { onConflict: "code" });
  }
  await dbAddActivity("agent_invite_link_created", code + " (" + (note || "Private Agent Invite") + ")");
  return item;
}

async function dbVerifyAgentInviteLink(code) {
  var clean = String(code || "").trim().toUpperCase();
  if (!clean || clean.indexOf("INV-") !== 0) return null;

  if (!IS_DEMO_MODE && supabaseClient) {
    try {
      var res = await supabaseClient.from("agent_links").select("*").eq("code", clean).maybeSingle();
      if (res.data && res.data.active !== false) return res.data;
      if (res.data && res.data.active === false) return null;
    } catch (e) {}
  }

  var list = readSaved("pigem_agent_links", []);
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].code || "").toUpperCase() === clean && list[i].active !== false) {
      return list[i];
    }
  }
  return null;
}

async function dbConsumeAgentInviteLink(code, registeredAgentEmail) {
  var clean = String(code || "").trim().toUpperCase();
  if (!clean) return;
  var list = readSaved("pigem_agent_links", []);
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].code || "").toUpperCase() === clean) {
      list[i].active = false;
      list[i].note = (list[i].note || "Invite") + " [Used by " + registeredAgentEmail + "]";
    }
  }
  writeSaved("pigem_agent_links", list);
  if (!IS_DEMO_MODE && supabaseClient) {
    try {
      await supabaseClient.from("agent_links").update({
        active: false,
        note: "Registered by " + registeredAgentEmail
      }).eq("code", clean);
    } catch (e) {}
  }
}

async function dbListAgentLinks() {
  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("agent_links").select("*").order("created_at", { ascending: false });
    if (res.data && res.data.length > 0) return res.data;
  }
  return readSaved("pigem_agent_links", [
    { code: "REF-CAV01", agent_email: "agent@demo.test", note: "Dasmariñas Walk-in Desk", created_at: new Date(Date.now() - 86400000).toISOString() }
  ]);
}

async function dbListUsers() {
  return await dbListProfiles();
}

async function dbGetUsers() {
  return await dbListProfiles();
}

async function dbHasAdminAccount() {
  if (IS_DEMO_MODE) {
    var demoList = getDemoUsers();
    for (var i = 0; i < demoList.length; i++) {
      if (demoList[i].role === "admin") return true;
    }
    return false;
  }
  try {
    var res = await supabaseClient.from("users").select("id").eq("role", "admin").limit(1);
    return Boolean(res.data && res.data.length > 0);
  } catch (e) {
    return false;
  }
}

async function dbCreateUserAccount(fullName, email, password, role, username) {
  var targetRole = role || "agent";
  var cleanEmail = email ? String(email).trim().toLowerCase() : null;
  var cleanUsername = String(username || "").trim().toLowerCase().replace(/^@/, "");

  if (targetRole === "customer") {
    if (!cleanEmail || (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail))) {
      throw new Error("Customer accounts must use a valid @gmail.com email address.");
    }
  } else {
    cleanEmail = null;
    if (!cleanUsername) {
      throw new Error("Username is required for internal Admin, Manager, and Agent accounts.");
    }
  }

  if (cleanUsername) {
    if (typeof isValidUsername === "function" && !isValidUsername(cleanUsername)) {
      throw new Error("Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
    }
    if (await dbIsUsernameTaken(cleanUsername, null)) {
      throw new Error("Username '@" + cleanUsername + "' is already taken. Please choose another username.");
    }
  } else {
    cleanUsername = await dbGenerateUniqueUsername(fullName, cleanEmail || fullName);
  }

  if (targetRole === "admin") {
    var alreadyHasAdmin = await dbHasAdminAccount();
    if (alreadyHasAdmin) {
      throw new Error("Only one System Administrator account is permitted in the system.");
    }
  }

  var users = getDemoUsers();
  var userId = targetRole + "-" + Date.now();
  var pwHash = await hashPassword(password || "");

  if (!IS_DEMO_MODE && supabaseClient) {
    if (cleanEmail) {
      var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
      if (existing.data) throw new Error("Account email is already registered in the database.");
    }

    if (targetRole === "customer" && cleanEmail) {
      try {
        var signUpRes = await supabaseClient.auth.signUp({
          email: cleanEmail,
          password: password,
          options: { data: { full_name: fullName, username: cleanUsername, role: "customer" } }
        });
        if (signUpRes.data && signUpRes.data.user && signUpRes.data.user.id) {
          userId = signUpRes.data.user.id;
        }
      } catch (authErr) {}
    }

    var dbRow = {
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      full_name: fullName,
      role: targetRole,
      password_hash: pwHash,
      password_changed_at: new Date().toISOString(),
      password_history: [],
      active: true,
      activated: true,
      activation_code: null
    };
    var upRes = cleanEmail
      ? await supabaseClient.from("users").upsert(dbRow, { onConflict: "email" })
      : await supabaseClient.from("users").insert(dbRow);
    if (upRes.error) throw new Error(upRes.error.message);
  } else {
    if (cleanEmail && findDemoUserByEmail(cleanEmail)) {
      throw new Error("Account email is already registered.");
    }
    if (findDemoUserByUsername(cleanUsername)) {
      throw new Error("Username '@" + cleanUsername + "' is already registered.");
    }
  }

  var u = {
    id: userId,
    username: cleanUsername,
    email: cleanEmail,
    password_hash: pwHash,
    full_name: fullName,
    role: targetRole,
    active: true,
    activated: true
  };
  var filtered = users.filter(function (x) {
    return (cleanEmail ? x.email !== cleanEmail : true) && String(x.username || "").toLowerCase() !== cleanUsername;
  });
  filtered.push(u);
  writeSaved("pigem_users", filtered);
  await dbAddActivity("user_registered", fullName + " (@" + cleanUsername + (cleanEmail ? " / " + cleanEmail : "") + " - " + targetRole + ")");
  return u;
}

async function dbAdminResetUserPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }
  var pwHash = await hashPassword(newPassword);
  var nowIso = new Date().toISOString();
  var targetUser = null;
  var users = getDemoUsers();
  for (var idx = 0; idx < users.length; idx++) {
    if (users[idx].id === userId) { targetUser = users[idx]; break; }
  }
  if (!IS_DEMO_MODE && supabaseClient) {
    var curRes = await supabaseClient.from("users").select("*").eq("id", userId).maybeSingle();
    if (curRes.data) targetUser = curRes.data;
  }
  if (targetUser) {
    var reuse = checkPasswordHistoryReuse(targetUser, pwHash);
    if (reuse.reused) throw new Error(reuse.message);
  }
  var nextHist = buildNextPasswordHistory(targetUser);
  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("users").update({
      activated: true,
      password_hash: pwHash,
      password_changed_at: nowIso,
      password_history: nextHist,
      activation_code: null
    }).eq("id", userId).select("*").single();
    if (res.error) throw new Error(res.error.message);
  }
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      users[i].password_hash = pwHash;
      users[i].password_changed_at = nowIso;
      users[i].password_history = nextHist;
      delete users[i].password;
      users[i].activation_code = "";
    }
  }
  writeSaved("pigem_users", users);
  await dbAddActivity("password_reset_by_admin", "Updated password for user ID " + userId);
  return true;
}

async function dbUpdateUser(userId, changes) {
  return await dbUpdateProfile(userId, changes);
}

async function dbAdminUpdateStaffAccount(userId, changes) {
  var updates = {};
  if (changes.full_name != null) updates.full_name = String(changes.full_name).trim();
  if (changes.username != null) {
    var cleanU = String(changes.username).trim().toLowerCase().replace(/^@/, "");
    if (typeof isValidUsername === "function" && !isValidUsername(cleanU)) {
      throw new Error("Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
    }
    if (await dbIsUsernameTaken(cleanU, userId)) {
      throw new Error("Username '@" + cleanU + "' is already taken.");
    }
    updates.username = cleanU;
  }
  if (changes.role != null) {
    if (changes.role === "admin") {
      throw new Error("Cannot promote an additional account to System Administrator.");
    }
    updates.role = changes.role;
  }
  if (changes.new_password) {
    if (typeof validatePasswordStrength === "function") {
      var pwCheck = validatePasswordStrength(changes.new_password);
      if (!pwCheck.valid) throw new Error(pwCheck.message);
    }
    var curUser = null;
    if (!IS_DEMO_MODE && supabaseClient) {
      var cuRes = await supabaseClient.from("users").select("*").eq("id", userId).maybeSingle();
      curUser = cuRes.data || null;
    } else {
      var dl = getDemoUsers();
      for (var k = 0; k < dl.length; k++) if (dl[k].id === userId) { curUser = dl[k]; break; }
    }
    var nextHash = await hashPassword(changes.new_password);
    if (curUser) {
      var reuse = checkPasswordHistoryReuse(curUser, nextHash);
      if (reuse.reused) throw new Error(reuse.message);
      updates.password_history = buildNextPasswordHistory(curUser);
    }
    updates.password_hash = nextHash;
    updates.password_changed_at = new Date().toISOString();
    updates.activation_code = null;
  }
  var updated = await dbUpdateProfile(userId, updates);
  await dbAddActivity("staff_account_updated", (updates.username ? "@" + updates.username : userId) + " updated");
  return updated;
}

async function dbDeleteUserAccount(userId) {
  if (!userId) throw new Error("Missing user ID.");
  var target = null;
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      target = users[i];
      break;
    }
  }
  if (!IS_DEMO_MODE && supabaseClient && !target) {
    var lookup = await supabaseClient.from("users").select("*").eq("id", userId).maybeSingle();
    target = lookup.data;
  }
  if (target && target.role === "admin") {
    throw new Error("The primary System Administrator account cannot be deleted.");
  }
  if (!IS_DEMO_MODE && supabaseClient) {
    var delRes = await supabaseClient.from("users").delete().eq("id", userId);
    if (delRes.error) throw new Error(delRes.error.message);
  }
  writeSaved("pigem_users", users.filter(function (u) { return u.id !== userId; }));
  await dbAddActivity("user_deleted", (target && target.username ? "@" + target.username : userId));
  return true;
}

async function dbChangeStaffPasswordDirect(userId, currentPassword, newPassword) {
  if (!userId) throw new Error("Missing user ID.");
  if (typeof validatePasswordStrength === "function") {
    var pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.valid) throw new Error(pwCheck.message);
  }
  var userObj = null;
  if (IS_DEMO_MODE) {
    var list = getDemoUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === userId) { userObj = list[i]; break; }
    }
  } else if (supabaseClient) {
    var res = await supabaseClient.from("users").select("*").eq("id", userId).maybeSingle();
    userObj = res.data;
  }
  if (!userObj) throw new Error("Account not found.");
  var curHash = await hashPassword(currentPassword || "");
  var matched = Boolean(
    (userObj.password_hash && userObj.password_hash === curHash) ||
    (userObj.password && (userObj.password === currentPassword || userObj.password === curHash)) ||
    (userObj.activation_code && (
      userObj.activation_code === ("PW:" + curHash) ||
      userObj.activation_code === ("PW:" + currentPassword)
    ))
  );
  if (!matched) {
    throw new Error("Current password is incorrect.");
  }
  var nextHash = await hashPassword(newPassword);
  var reuse = checkPasswordHistoryReuse(userObj, nextHash);
  if (reuse.reused) {
    throw new Error(reuse.message);
  }
  var nowIso = new Date().toISOString();
  await dbUpdateProfile(userId, {
    password_hash: nextHash,
    password_changed_at: nowIso,
    password_history: buildNextPasswordHistory(userObj),
    activation_code: null
  });
  await dbAddActivity("password_changed_self", "@" + (userObj.username || userId));
  return true;
}

async function dbRequestStaffPasswordReset(username, note) {
  var clean = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!clean) throw new Error("Please enter your staff username.");
  var found = null;
  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("users").select("*").ilike("username", clean).maybeSingle();
    found = res.data || null;
  } else {
    found = findDemoUserByUsername(clean);
  }
  if (!found) {
    throw new Error("No staff account was found with username '@" + clean + "'.");
  }
  if (found.role === "admin") {
    throw new Error("System Administrator credentials cannot be reset via staff request.");
  }
  if (found.role === "customer") {
    throw new Error("Customer accounts should use the Customer Login Forgot Password option.");
  }
  var detailMsg = "Staff user " + (found.full_name || "@" + clean) + " (@" + clean + ", " + String(found.role || "").toUpperCase() + ") requested a password reset." +
    (note ? " Note: " + note : "");
  await dbAddNotification({
    role: "admin",
    title: "Password Reset Request: @" + clean,
    message: detailMsg,
    target_tab: "tab-accounts",
    target_id: found.id
  });
  await dbAddActivity("staff_password_reset_requested", "@" + clean + (note ? " - " + note : ""));
  return {
    username: clean,
    role: found.role,
    full_name: found.full_name || clean
  };
}

async function dbSaveLiveWebsiteContent(content) {
  if (IS_DEMO_MODE || !supabaseClient) return { saved: true, localOnly: true };
  var res = await supabaseClient.from("website_content").upsert({
    id: "main",
    data: content,
    updated_at: new Date().toISOString()
  });
  if (res.error) {
    throw new Error(res.error.message);
  }
  return { saved: true };
}

async function dbSaveLivePlans(plans) {
  if (IS_DEMO_MODE || !supabaseClient || !Array.isArray(plans)) return;
  try {
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      await supabaseClient.from("plans").upsert({
        id: String(p.id),
        name: p.name,
        speed: Number(String(p.speed).replace(/[^0-9]/g, "")) || 100,
        price: Number(p.price) || 1000,
        tag: p.tag || "Fiber for your home",
        featured: Boolean(p.featured),
        active: p.active !== false
      });
    }
  } catch (e) {}
}

async function dbSaveLiveSystemSettings(settings) {
  if (IS_DEMO_MODE || !supabaseClient) return;
  try {
    await supabaseClient.from("system_settings").upsert({
      id: "main",
      ai_enabled: Boolean(settings.ai_enabled),
      maintenance_mode: Boolean(settings.maintenance_mode),
      maintenance_message: settings.maintenance_message || "",
      updated_at: new Date().toISOString()
    });
  } catch (e) {}
}

function normalizeWebsiteAssetFolder(category) {
  var c = String(category || "").trim().toLowerCase();
  if (c === "logos" || c === "logo") return "Logos";
  if (c === "clients" || c === "client") return "Clients";
  if (c === "vehicles" || c === "vehicle") return "Vehicles";
  if (c === "permits" || c === "permit") return "Permits";
  return "Banners";
}

function mergeAssetPathLists(existingList, discoveredList) {
  var out = [];
  var seen = {};
  var sources = [existingList || [], discoveredList || []];
  for (var s = 0; s < sources.length; s++) {
    for (var i = 0; i < sources[s].length; i++) {
      var val = String(sources[s][i] || "").trim();
      if (!val || seen[val]) continue;
      seen[val] = true;
      out.push(val);
    }
  }
  return out;
}

async function dbListWebsiteAssetBucketFiles() {
  if (IS_DEMO_MODE || !supabaseClient || !supabaseClient.storage) return null;
  var folders = ["Banners", "Logos", "Clients", "Vehicles", "Permits"];
  var discovered = { Banners: [], Logos: [], Clients: [], Vehicles: [], Permits: [] };
  var isImgFile = function (name) {
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(name || ""));
  };

  try {
    var rootRes = await supabaseClient.storage.from("website-assets").list("", { limit: 100 });
    if (!rootRes.error && Array.isArray(rootRes.data)) {
      for (var r = 0; r < rootRes.data.length; r++) {
        var item = rootRes.data[r];
        if (item && item.id && isImgFile(item.name)) {
          discovered.Logos.push(item.name);
        }
      }
    }
  } catch (e) {}

  for (var f = 0; f < folders.length; f++) {
    var folderName = folders[f];
    try {
      var res = await supabaseClient.storage.from("website-assets").list(folderName, {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" }
      });
      if (!res.error && Array.isArray(res.data)) {
        for (var i = 0; i < res.data.length; i++) {
          var obj = res.data[i];
          if (!obj || !obj.name || obj.name === ".emptyFolderPlaceholder" || !isImgFile(obj.name)) continue;
          discovered[folderName].push(folderName + "/" + obj.name);
        }
      }
    } catch (e) {}
  }
  return discovered;
}

async function dbUploadWebsiteAsset(file, category) {
  if (!file) throw new Error("Please select an image file first.");
  var isImage = String(file.type || "").indexOf("image/") === 0 || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || "");
  if (!isImage) throw new Error("Please upload a valid image file (PNG, JPG, WEBP, or SVG).");
  if (file.size && file.size > 10 * 1024 * 1024) {
    throw new Error("Image file size must not exceed 10 MB.");
  }

  var folder = normalizeWebsiteAssetFolder(category);
  var savedPath = "";

  if (IS_DEMO_MODE || !supabaseClient) {
    savedPath = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else {
    var cleanName = String(file.name || "asset.png").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
    var path = folder + "/" + Date.now() + "-" + cleanName;
    var res = await supabaseClient.storage.from("website-assets").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/png"
    });
    if (res.error) throw new Error(res.error.message);
    savedPath = path;
  }

  var wc = getWebsiteContent();
  wc.asset_library = wc.asset_library || {};
  wc.asset_library[folder] = mergeAssetPathLists([savedPath], wc.asset_library[folder] || []);
  writeSaved("pigem_website_content", wc);
  await dbSaveLiveWebsiteContent(wc);
  await dbAddActivity("website_asset_uploaded", folder + ": " + file.name);
  return savedPath;
}

async function dbSyncLiveSettingsAndContent() {
  if (IS_DEMO_MODE || !supabaseClient) return;
  try {
    var setRes = await supabaseClient.from("system_settings").select("*").eq("id", "main").maybeSingle();
    if (setRes.data) {
      writeSaved("pigem_system_settings", {
        ai_enabled: setRes.data.ai_enabled !== false,
        maintenance_mode: Boolean(setRes.data.maintenance_mode),
        maintenance_message: setRes.data.maintenance_message || ""
      });
      if (typeof checkPublicMaintenance === "function") checkPublicMaintenance();
    }

    var wcRes = await supabaseClient.from("website_content").select("*").eq("id", "main").maybeSingle();
    var wcData = (wcRes.data && wcRes.data.data && Object.keys(wcRes.data.data).length > 0)
      ? Object.assign({}, DEFAULT_CONTENT, wcRes.data.data)
      : getWebsiteContent();

    var bucketFiles = await dbListWebsiteAssetBucketFiles();
    if (bucketFiles) {
      var baseLib = Object.assign({}, DEFAULT_CONTENT.asset_library, wcData.asset_library || {});
      baseLib.Banners = mergeAssetPathLists(baseLib.Banners, bucketFiles.Banners);
      baseLib.Logos = mergeAssetPathLists(baseLib.Logos, bucketFiles.Logos);
      baseLib.Clients = mergeAssetPathLists(baseLib.Clients, bucketFiles.Clients);
      baseLib.Vehicles = mergeAssetPathLists(baseLib.Vehicles, bucketFiles.Vehicles);
      baseLib.Permits = mergeAssetPathLists(baseLib.Permits, bucketFiles.Permits);
      wcData.asset_library = baseLib;
      if ((!wcData.hero_slides || wcData.hero_slides.length === 0) && baseLib.Banners.length > 0) {
        wcData.hero_slides = baseLib.Banners.slice(0, 4).map(function (bPath) { return { image: bPath }; });
      }
    }
    writeSaved("pigem_website_content", wcData);

    var plansRes = await supabaseClient.from("plans").select("*").eq("active", true).order("price", { ascending: true });
    if (plansRes.data && plansRes.data.length > 0) {
      writeSaved("pigem_plans", plansRes.data);
    }

    if (typeof loadPageImages === "function") loadPageImages();
    if (typeof window.onLiveContentSynced === "function") window.onLiveContentSynced();
  } catch (e) {
    if (typeof showSystemMaintenanceNotice === "function") {
      showSystemMaintenanceNotice("Cloud Database and asset storage is temporarily unreachable. Public services are operating in maintenance mode.");
    }
  }
}

async function dbSyncPopupGuides() {
  return [];
}

async function dbListPopupGuides() {
  return [];
}

async function dbSavePopupGuide(guideRow) {
  return true;
}

async function dbNotifyScreeningUnavailable(refNo, customerName, detailText) {
  var dedupKey = "pigem_unavail_alert_" + (refNo || "session");
  if (sessionStorage.getItem(dedupKey) === "1") return;
  sessionStorage.setItem(dedupKey, "1");

  var title = refNo
    ? "Auto-Screening Unavailable (" + refNo + ")"
    : "Auto-Screening Currently Unavailable";
  var body =
    (refNo ? ("Application " + refNo + (customerName ? " (" + customerName + ")" : "") + " was submitted while auto-screening is unavailable. ") : "Auto-screening is currently not active. ") +
    (detailText || "The customer's original uploaded ID copies are ready for manual verification.");

  try {
    await dbAddNotification(null, "agent", title, body);
    await dbAddNotification(null, "manager", title, body);
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", function () {
  dbSyncLiveSettingsAndContent();
});

async function apiCheckIdPhoto(file, details) {
  var res = await apiRunScreening(file, details);
  return {
    overall_status: res.overall_status || (res.status === "not_available" ? "Checked (Fallback)" : "Verified"),
    blur_score: res.blur_score || 120,
    name_match: res.name_match !== false,
    id_number_match: res.id_number_match !== false,
    issues: res.issues || []
  };
}

if (typeof apiSendOtpEmail === "undefined") {
  window.apiSendOtpEmail = async function (toEmail, code, title, recipientName) {
    var subject = "PIGEM Account Security - " + (title || "Verification Code");
    var body =
      "Dear Valued Client,\n\n" +
      "We received a verification request for your PIGEM Combined Facilities Support Services account (" + toEmail + ").\n\n" +
      "Your 6-Digit Verification Code is: " + code + "\n\n" +
      "Please enter this code on the verification screen to complete your request. For your security, do not share this code with anyone.\n\n" +
      "Sincerely,\n" +
      "Customer Security & Verification Team\n" +
      "PIGEM Combined Facilities Support Services";
    return await apiSendEmail(toEmail, subject, body, {
      template_type: "otp",
      payload: {
        code: String(code),
        purpose: title || "Account Verification",
        customer_name: recipientName || "Valued Client"
      }
    });
  };
}

if (typeof apiSendStatusEmail === "undefined") {
  window.apiSendStatusEmail = async function (toEmail, fullName, refNo, status, remarks, targetSummary) {
    var st = (status || "").toLowerCase();
    var isCorrection = st.indexOf("correction") !== -1 || st.indexOf("need") !== -1;
    var custSt = (st.indexOf("approv") !== -1) ? "Approved" : ((st.indexOf("reject") !== -1) ? "Rejected" : "Processing");
    var subject = isCorrection
      ? "PIGEM Action Required - Update Needed for Reference No. " + refNo
      : "PIGEM Application Update - Reference No. " + refNo + " [" + custSt + "]";
    var body =
      "Dear " + (fullName || "Valued Subscriber") + ",\n\n" +
      "Please be advised that there is an official status update regarding your Red Fiber Internet Service Application with PIGEM Combined Facilities Support Services.\n\n" +
      "APPLICATION STATUS UPDATE\n" +
      "- Reference Number: " + refNo + "\n" +
      "- Current Status: " + custSt + "\n" +
      (remarks ? "- Verification Remarks / Instructions:\n" + remarks + "\n\n" : "\n") +
      "You may sign in to your PIGEM Customer Portal account at any time to view the full details of your application or submit any requested updates.\n\n" +
      "Thank you for choosing PIGEM Combined Facilities Support Services.\n\n" +
      "Sincerely,\n" +
      "Customer Verification & Provisioning Team\n" +
      "PIGEM Combined Facilities Support Services\n" +
      "Tel: (046) 458-0908 | Hotline: 101-733 (RED)";

    return await apiSendEmail(toEmail, subject, body, {
      template_type: isCorrection ? "correction_notice" : "status_update",
      payload: {
        ref_no: refNo,
        customer_name: fullName,
        status: custSt,
        remarks: remarks || "",
        target_summary: targetSummary || "Information / Document Clarification Required",
        portal_link: (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin.indexOf("http") === 0 ? window.location.origin : (CONFIG.PUBLIC_URL || "https://pigem-system-web.vercel.app")) + "/customer.html"
      }
    });
  };
}

async function dbUploadQrSessionFile(sid, side, file) {
  var cleanSid = String(sid || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanSid || !file) throw new Error("Missing QR upload session or file.");
  var cleanSide = side === "back" ? "back" : "front";
  var ext = (file.name && file.name.split(".").pop()) || "jpg";
  var url = "";

  if (!IS_DEMO_MODE && supabaseClient && supabaseClient.storage) {
    try {
      var storagePath = "qr_sessions/" + cleanSid + "/" + cleanSide + "-" + Date.now() + "." + ext;
      var upRes = await supabaseClient.storage.from("documents").upload(storagePath, file, {
        cacheControl: "60",
        upsert: true,
        contentType: file.type || "image/jpeg"
      });
      if (!upRes.error) {
        var pub = supabaseClient.storage.from("documents").getPublicUrl(storagePath);
        if (pub && pub.data && pub.data.publicUrl) {
          url = pub.data.publicUrl;
        }
      }
    } catch (err) {}
  }

  if (!url) {
    url = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  var cached = readSaved("pigem_qr_" + cleanSid, {});
  if (cleanSide === "front") cached.frontUrl = url;
  else cached.backUrl = url;
  cached.updatedAt = Date.now();
  writeSaved("pigem_qr_" + cleanSid, cached);
  return url;
}

async function dbListQrSessionFiles(sid) {
  var cleanSid = String(sid || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanSid) return { frontUrl: "", backUrl: "" };
  var result = { frontUrl: "", backUrl: "" };

  if (!IS_DEMO_MODE && supabaseClient && supabaseClient.storage) {
    try {
      var res = await supabaseClient.storage.from("documents").list("qr_sessions/" + cleanSid, {
        limit: 20,
        sortBy: { column: "created_at", order: "desc" }
      });
      if (!res.error && Array.isArray(res.data)) {
        for (var i = 0; i < res.data.length; i++) {
          var item = res.data[i];
          if (!item || !item.name) continue;
          if (!result.frontUrl && item.name.indexOf("front-") === 0) {
            var p1 = supabaseClient.storage.from("documents").getPublicUrl("qr_sessions/" + cleanSid + "/" + item.name);
            if (p1 && p1.data) result.frontUrl = p1.data.publicUrl;
          }
          if (!result.backUrl && item.name.indexOf("back-") === 0) {
            var p2 = supabaseClient.storage.from("documents").getPublicUrl("qr_sessions/" + cleanSid + "/" + item.name);
            if (p2 && p2.data) result.backUrl = p2.data.publicUrl;
          }
        }
      }
    } catch (e) {}
  }

  var local = readSaved("pigem_qr_" + cleanSid, {});
  if (!result.frontUrl && local.frontUrl) result.frontUrl = local.frontUrl;
  if (!result.backUrl && local.backUrl) result.backUrl = local.backUrl;
  return result;
}
