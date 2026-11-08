// ============================================================================
// FILE: web/js/db.js
// PURPOSE: Supabase Cloud Database, Authentication & Private Storage Layer
// ----------------------------------------------------------------------------
// SHARED SCRIPT IMPORTS (Loaded before this file via HTML <script> tags):
//   1. @supabase/supabase-js@2 (CDN) -> Exposes global `window.supabase` client SDK
//   2. web/js/config.js              -> Exposes `CONFIG.SUPABASE_URL` & `CONFIG.SUPABASE_KEY`
//   3. Browser Web Crypto API        -> `crypto.subtle.digest("SHA-256", ...)` for hashing
//   4. HTML5 Canvas API              -> Compresses high-res ID photos before cloud upload
// ============================================================================

var SYSTEM = window.SYSTEM || "customer";

// Roles allowed to sign in to each system
var SYSTEM_ROLES = {
  customer: ["customer"],
  staff: ["agent", "manager"],
  admin: ["admin"]
};

// Each system keeps its own login session so they never mix.
// Staff and admin use sessionStorage (one session per browser tab), so two agents,
// or an agent and the manager, can work in different tabs without replacing each other.
var SESSION_KEY = "pigem_session_" + SYSTEM;
var sessionStore = SYSTEM === "customer" ? localStorage : sessionStorage;

var IS_DEMO_MODE = (CONFIG.SUPABASE_URL === "" || CONFIG.SUPABASE_ANON_KEY === "");
var supabaseClient = null;

if (!IS_DEMO_MODE && window.supabase) {
  // Connect to Supabase with a separate saved session for each system
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { storageKey: "pigem-" + SYSTEM, storage: sessionStore }
  });
}

// Demo accounts (password: demo123)

// SHA-256 Client-Side Password Hasher
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

// Data Accessor `getDemoUsers`: Retrieves or refreshes state to get demo users.
function getDemoUsers() {
  var users = readSaved("pigem_users", []);
  if (!Array.isArray(users)) users = [];
  // Purge any lingering demo accounts from local cache
  var clean = users.filter(function (u) {
    return u && u.id && u.id.indexOf("demo-") !== 0 && (u.email || "").indexOf("@demo.test") === -1;
  });
  if (clean.length !== users.length) {
    writeSaved("pigem_users", clean);
  }
  return clean;
}

// Data Accessor `findDemoUserByEmail` (params: email): Retrieves or refreshes state to find demo user by email.
function findDemoUserByEmail(email) {
  var target = String(email || "").trim().toLowerCase();
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || "").toLowerCase() === target) return users[i];
  }
  return null;
}

// Data Accessor `findDemoUserByUsername` (params: username): Finds a locally cached user record by case-insensitive username.
function findDemoUserByUsername(username) {
  var target = String(username || "").trim().toLowerCase();
  if (!target) return null;
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username || "").toLowerCase() === target) return users[i];
  }
  return null;
}

// Validation/Database helper `dbIsUsernameTaken` (params: username, excludeUserId): Checks if a username is already owned by another account.
async function dbIsUsernameTaken(username, excludeUserId) {
  var clean = String(username || "").trim().toLowerCase();
  if (!clean) return false;

  var localMatch = findDemoUserByUsername(clean);
  if (localMatch && localMatch.id !== excludeUserId) {
    return true;
  }

  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("users").select("id, username").ilike("username", clean).limit(5);
    if (res.data && res.data.length > 0) {
      for (var i = 0; i < res.data.length; i++) {
        if (res.data[i].id !== excludeUserId) return true;
      }
    }
  }
  return false;
}

// Helper function `dbGenerateUniqueUsername` (params: fullName, email, preferredUsername): Produces a guaranteed-unique valid username.
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

// Data Accessor `dbGetSuggestedUsername` (params: email): Returns the existing assigned username or a clean suggested username for activation.
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

// Address of the login page for this system
function getLoginPage() {
  if (SYSTEM === "staff") return ROOT + "staff-login.html";
  if (SYSTEM === "admin") return ROOT + "admin-login.html";
  return ROOT + "login.html";
}

// ============================================================
// 1. Login and accounts
// ============================================================

// Get the user signed in to THIS system
async function dbGetCurrentUser() {
  // Check tab/system session first (works for built-in staff/demo accounts and local sessions)
  var currentId = sessionStore.getItem(SESSION_KEY);
  if (currentId) {
    var localUsers = getDemoUsers();
    for (var i = 0; i < localUsers.length; i++) {
      if (localUsers[i].id === currentId && localUsers[i].active) return localUsers[i];
    }
    if (!IS_DEMO_MODE) {
      var dbUser = await supabaseClient.from("users").select("*").eq("id", currentId).maybeSingle();
      if (dbUser.data && dbUser.data.active) return dbUser.data;
    }
  }

  if (IS_DEMO_MODE) return null;

  var sessionRes = await supabaseClient.auth.getSession();
  var session = sessionRes.data.session;
  if (!session) return null;

  // Read the role from the "users" table (create a customer row on first login)
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
  if (!res.data.active) return null;
  return res.data;
}

// Sign in using either Username or Email Address. Role and portal domain rules are strictly enforced.
async function dbSignIn(identifier, password) {
  var cleanInput = String(identifier || "").trim().toLowerCase();
  if (!cleanInput) throw new Error("Please enter your username or email address.");

  var cleanEmail = "";
  var preloadedDbRow = null;

  if (cleanInput.indexOf("@") !== -1) {
    cleanEmail = cleanInput;
    if (SYSTEM === "customer" && typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
      throw new Error("Customer Login accepts @gmail.com accounts or Customer usernames only.");
    }
    if ((SYSTEM === "staff" || SYSTEM === "admin") && typeof isCustomerGmail === "function" && isCustomerGmail(cleanEmail)) {
      throw new Error("Internal portals require an internal staff email (such as @pigem.ph) or staff username, not a Gmail account.");
    }
  } else {
    if (typeof isValidUsername === "function" && !isValidUsername(cleanInput)) {
      throw new Error("Please enter a valid username (3-30 characters) or email address.");
    }
    var localByUser = findDemoUserByUsername(cleanInput);
    if (localByUser) {
      cleanEmail = String(localByUser.email || "").trim().toLowerCase();
    }
    if (!cleanEmail && !IS_DEMO_MODE && supabaseClient) {
      var uRes = await supabaseClient.from("users").select("*").ilike("username", cleanInput).maybeSingle();
      if (uRes.data) {
        preloadedDbRow = uRes.data;
        cleanEmail = String(uRes.data.email || "").trim().toLowerCase();
      }
    }
    if (!cleanEmail) {
      throw new Error("Invalid username or password.");
    }
    if (SYSTEM === "customer" && typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
      throw new Error("This username belongs to an internal staff account. Please use the Staff or Admin Login page.");
    }
    if ((SYSTEM === "staff" || SYSTEM === "admin") && typeof isCustomerGmail === "function" && isCustomerGmail(cleanEmail)) {
      throw new Error("Customer accounts must sign in on the Customer Login page.");
    }
  }

  var user = null;

  // 1. Check built-in/local accounts first (so Agent, Manager, Admin, and Demo accounts always work)
  var found = findDemoUserByEmail(cleanEmail);
  var enteredHash = await hashPassword(password);
  if (found && (found.password === password || found.password_hash === enteredHash || found.password === enteredHash)) {
    if (found.role === "customer" && !found.activated) {
      throw new Error("Please activate your account first using the link sent to your email.");
    }
    if (!found.active) throw new Error("This account is disabled. Please contact PIGEM.");
    if (!found.username) {
      found.username = await dbGenerateUniqueUsername(found.full_name, found.email);
    }
    user = found;
    if (!IS_DEMO_MODE) {
      await supabaseClient.from("users").upsert({
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        active: user.active,
        activated: true
      }, { onConflict: "email" });
    }
  } else if (!IS_DEMO_MODE) {
    // 2. Check if password was reset/stored in public.users or sign in via Supabase Authentication
    var dbRow = preloadedDbRow ? { data: preloadedDbRow } : await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
    if (dbRow.data && (dbRow.data.activation_code === ("PW:" + password) || dbRow.data.activation_code === ("PW:" + enteredHash) || dbRow.data.activation_code === password)) {
      if (!dbRow.data.active) throw new Error("This account is disabled. Please contact PIGEM.");
      user = dbRow.data;
    } else {
      var res = await supabaseClient.auth.signInWithPassword({ email: cleanEmail, password: password });
      if (res.error) throw new Error(res.error.message);
      user = await dbGetCurrentUser();
      if (!user) throw new Error("This account is disabled. Please contact PIGEM.");
    }
  } else {
    throw new Error("Invalid username/email or password.");
  }

  if (SYSTEM_ROLES[SYSTEM].indexOf(user.role) === -1) {
    if (!IS_DEMO_MODE) await supabaseClient.auth.signOut();
    throw new Error("This account cannot sign in here.");
  }

  sessionStore.setItem(SESSION_KEY, user.id);
  await dbAddLoginHistory(user, "login");
  return user;
}

// Sign out of this system only
async function dbSignOut() {
  var user = await dbGetCurrentUser();
  if (user) await dbAddLoginHistory(user, "logout");
  sessionStore.removeItem(SESSION_KEY);
  if (!IS_DEMO_MODE) {
    await supabaseClient.auth.signOut();
  }
}

// Send a password reset email (Supabase Authentication)
async function dbResetPassword(email) {
  if (IS_DEMO_MODE) return;
  var res = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (res.error) throw new Error(res.error.message);
}

// Token sent to the Python server so it knows who is calling
async function dbGetToken() {
  if (IS_DEMO_MODE) return "";
  var res = await supabaseClient.auth.getSession();
  return res.data.session ? res.data.session.access_token : "";
}

// Stop the page if the signed-in user does not have the right role
async function checkPageAccess(allowedRoles) {
  if (typeof allowedRoles === "string") allowedRoles = [allowedRoles];
  var user = await dbGetCurrentUser();
  if (!user || allowedRoles.indexOf(user.role) === -1) {
    window.location.href = getLoginPage();
    return null;
  }
  return user;
}

// Create a customer account when an application is submitted, assigning a unique username.
// Returns status "new" (activation email sent), "pending" (not yet activated, email sent again),
// or "active" (already has an account, just log in).
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

  // Live mode: if the email already has an activated account, do not send activation again
  var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
  if (existing.data && existing.data.activated) {
    return { user: existing.data, status: "active", code: "" };
  }

  var assignedUsername = (existing.data && existing.data.username)
    ? existing.data.username
    : (await dbGenerateUniqueUsername(fullName, cleanEmail, preferredUsername));

  // Save pending customer row with unique username and 6-digit activation_code (emailed via Gmail SMTP by apply.js)
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

// Activate a customer account ONE time (code from email + chosen username + new password)
async function dbActivateCustomerAccount(email, code, newPassword, chosenUsername) {
  var cleanEmail = email.trim().toLowerCase();
  if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
    throw new Error("Customer Account activation is for @gmail.com accounts only.");
  }
  var cleanChosenUser = String(chosenUsername || "").trim().toLowerCase();
  if (cleanChosenUser && typeof isValidUsername === "function" && !isValidUsername(cleanChosenUser)) {
    throw new Error("Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
  }

  if (IS_DEMO_MODE) {
    var users = getDemoUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === cleanEmail) {
        if (users[i].activated) throw new Error("This account is already activated. Please log in.");
        if (users[i].activation_code !== code.trim()) throw new Error("The activation code is not correct.");
        if (cleanChosenUser) {
          if (await dbIsUsernameTaken(cleanChosenUser, users[i].id)) {
            throw new Error("That username is already taken. Please choose another username.");
          }
          users[i].username = cleanChosenUser;
        } else if (!users[i].username) {
          users[i].username = await dbGenerateUniqueUsername(users[i].full_name, cleanEmail);
        }
        users[i].password = newPassword;
        users[i].activated = true;
        users[i].activation_code = "";
        writeSaved("pigem_users", users);
        sessionStore.setItem(SESSION_KEY, users[i].id);
        await dbAddLoginHistory(users[i], "account_activated");
        return users[i];
      }
    }
    throw new Error("No application was found for this email.");
  }

  // Live Supabase mode: check activation_code in public.users, validate username, then register in Supabase Auth
  var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
  if (!existing.data) throw new Error("No application was found for this email.");
  if (existing.data.activated) throw new Error("This account is already activated. Please log in.");
  if (String(existing.data.activation_code || "").trim() !== code.trim()) {
    throw new Error("The 6-digit activation code is not correct.");
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

  var signUpRes = await supabaseClient.auth.signUp({
    email: cleanEmail,
    password: newPassword,
    options: { data: { full_name: existing.data.full_name, username: finalUsername } }
  });
  if (signUpRes.error && signUpRes.error.message.toLowerCase().indexOf("already registered") === -1) {
    throw new Error(signUpRes.error.message);
  }

  var authUserId = (signUpRes.data && signUpRes.data.user && signUpRes.data.user.id) || existing.data.id;
  await supabaseClient.from("users").update({
    id: authUserId,
    username: finalUsername,
    activated: true,
    activation_code: "PW:" + newPassword
  }).eq("email", cleanEmail);

  await supabaseClient.auth.signInWithPassword({ email: cleanEmail, password: newPassword });
  sessionStore.setItem(SESSION_KEY, authUserId);
  var user = await dbGetCurrentUser();
  if (user) await dbAddLoginHistory(user, "account_activated");
  return user || existing.data;
}

// Check if an email already activated its account (used by activate.html)
async function dbIsAccountActivated(email) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  if (IS_DEMO_MODE) {
    var u = findDemoUserByEmail(cleanEmail);
    return Boolean(u && u.activated);
  }
  var res = await supabaseClient.from("users").select("activated").eq("email", cleanEmail).maybeSingle();
  return Boolean(res.data && res.data.activated);
}

// System Administrator helper to create an Agent account with a unique username
async function dbCreateAgentAccount(fullName, email, password, username) {
  return await dbCreateUserAccount(fullName, email, password, "agent", username);
}

// Update the signed-in user's own profile (name, username, photo, intro)
async function dbUpdateMyProfile(userId, changes) {
  return await dbUpdateProfile(userId, changes);
}

// ============================================================
// 2. login_history table
// ============================================================

async function dbAddLoginHistory(user, action) {
  var row = {
    user_id: user.id,
    username: user.username || null,
    email: user.email,
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

// Database/Storage helper `dbListLoginHistory`: Performs cloud Supabase operation to list login history.
async function dbListLoginHistory() {
  if (IS_DEMO_MODE) return readSaved("pigem_login_history", []);
  var res = await supabaseClient.from("login_history").select("*").order("created_at", { ascending: false }).limit(200);
  return res.data || [];
}

// ============================================================
// 3. applications table
// ============================================================

// Customers only see their own applications (matched by email). Staff see all.
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

// Database/Storage helper `dbGetApplication` (params: appId): Performs cloud Supabase operation to get application.
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

// Save a new application. A copy of what the customer first sent is kept in original_copy.
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
    customer_instruction: getDefaultStatusInstruction("Processing", ""),
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
  return res.data;
}

// Update an application (claim, status, correction, encoding, provider result)
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

// Add one line to the AI activity of an application (shown to agents like a chat)
async function dbAddAiLog(appId, who, text) {
  var app = await dbGetApplication(appId);
  if (!app) return;
  var log = app.ai_log || [];
  log.push({ at: new Date().toISOString(), who: who, text: text });
  await dbUpdateApplication(appId, { ai_log: log });
}

// ============================================================
// 4. File storage (documents bucket)
// ============================================================

// Upload an ID picture or encoding screenshot directly to Supabase Storage Bucket (documents)
async function dbUploadDocument(file, folder, label) {
  if (!file) return null;
  var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  var fileName = Date.now() + "-" + (label || "doc") + "." + ext;
  var path = (folder || "ids") + "/" + fileName;

  // 1. Direct Cloud Bucket Upload to Supabase 'documents' bucket
  if (!IS_DEMO_MODE && supabaseClient && supabaseClient.storage) {
    try {
      var res = await supabaseClient.storage.from("documents").upload(path, file, {
        cacheControl: "3600",
        upsert: true
      });
      if (!res.error) {
        var pub = supabaseClient.storage.from("documents").getPublicUrl(path);
        if (pub && pub.data && pub.data.publicUrl) {
          return pub.data.publicUrl;
        }
      }
    } catch (storageErr) {
      console.warn("Direct storage upload notice, utilizing secure encoded document payload:", storageErr);
    }
  }

  // 2. Fallback to base64 Data URL so customer application NEVER fails
  return await new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Get a short-lived link to view a private file
async function dbGetDocumentLink(path) {
  if (!path) return null;
  if (path.indexOf("data:") === 0 || path.indexOf("http") === 0 || IS_DEMO_MODE) return path;
  var res = await supabaseClient.storage.from("documents").createSignedUrl(path, 600);
  return res.error ? null : res.data.signedUrl;
}

// ============================================================
// 5. notifications and system_logs tables
// ============================================================

// Save a notification. Send to one person (user_id / email) or to everyone with a role (role: "agent").
async function dbAddNotification(note) {
  var row = {
    user_id: note.user_id || null,
    email: note.email || null,
    role: note.role || null,
    title: note.title || note.subject || "Notification",
    message: note.message || note.body || "",
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

// Database/Storage helper `dbListMyNotifications` (params: user): Performs cloud Supabase operation to list my notifications.
async function dbListMyNotifications(user) {
  if (IS_DEMO_MODE) {
    return readSaved("pigem_notifications", []).filter(function (n) {
      return n.user_id === user.id || n.email === user.email || n.role === user.role;
    });
  }
  var res = await supabaseClient.from("notifications").select("*")
    .or("user_id.eq." + user.id + ",email.eq." + user.email + ",role.eq." + user.role)
    .order("created_at", { ascending: false }).limit(50);
  return res.data || [];
}

// Database/Storage helper `dbAddActivity` (params: action, detail): Performs cloud Supabase operation to add activity.
async function dbAddActivity(action, detail) {
  var user = await dbGetCurrentUser();
  var row = {
    actor_username: user && user.username ? user.username : null,
    actor_email: user ? user.email : "public",
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

// Database/Storage helper `dbListActivity`: Performs cloud Supabase operation to list activity.
async function dbListActivity() {
  if (IS_DEMO_MODE) return readSaved("pigem_activity", []);
  var res = await supabaseClient.from("system_logs").select("*").order("created_at", { ascending: false }).limit(200);
  return res.data || [];
}

// ============================================================
// 6. users table
// ============================================================

async function dbListProfiles() {
  if (IS_DEMO_MODE) return getDemoUsers();
  var res = await supabaseClient.from("users").select("*").order("created_at", { ascending: false });
  return res.data || [];
}

// Database/Storage helper `dbUpdateProfile` (params: userId, changes): Updates user profile fields including validated unique username.
async function dbUpdateProfile(userId, changes) {
  var safeChanges = Object.assign({}, changes || {});
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

// Clear all Demo Mode records
function dbResetDemoData() {
  var keys = ["pigem_users", "pigem_applications", "pigem_notifications", "pigem_activity", "pigem_login_history",
    "pigem_provider_updates", "pigem_plans", "pigem_website_content", "pigem_system_settings", "pigem_session_customer"];
  for (var i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
  sessionStorage.clear();
}


// ============================================================
// 7. Convenience helpers & Demo Seed Data for Dashboards
// ============================================================

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
    id_image_url: "assets/images/logo.png",
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
    id_image_url: "assets/images/logo.png",
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
    id_image_url: "assets/images/logo.png",
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
      id_image_url: "assets/images/logo.png"
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

// Helper function `normalizeAppRecord` (params: a): Executes portal workflow logic for `normalizeAppRecord`.
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
    a.cropped_id_url = a.screening.cropped_id_url || (a.ai_result && a.ai_result.cropped_id_url) || "";
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

// Helper function `ensureDemoSeedApps`: Executes portal workflow logic for `ensureDemoSeedApps`.
function ensureDemoSeedApps() {
  var apps = readSaved("pigem_applications", null);
  if (!apps || apps.length === 0) {
    writeSaved("pigem_applications", DEFAULT_DEMO_APPS);
    return DEFAULT_DEMO_APPS.slice();
  }
  for (var i = 0; i < apps.length; i++) normalizeAppRecord(apps[i]);
  return apps;
}

// Formatter/Utility `escapeHtml` (params: str): Transforms or sanitizes data (escape html).
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// UI Interaction `showMsg` (params: id, type, text): Controls modal/panel visibility to show msg.
function showMsg(id, type, text) {
  var el = document.getElementById(id);
  if (!el) return;
  el.className = "msg show " + (type || "info");
  el.textContent = text;
}

// UI Interaction `hideMsg` (params: id): Controls modal/panel visibility to hide msg.
function hideMsg(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.className = "msg";
  el.textContent = "";
}

// Build a colored status badge for application status display
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

// Customer-facing 3-status mapper: ONLY "Processing", "Approved", or "Rejected"
function getCustomerStatus(rawStatus) {
  if (rawStatus === "Approved") return "Approved";
  if (rawStatus === "Rejected") return "Rejected";
  return "Processing";
}

// Customer badge: always shows one of the 3 main statuses, plus the "Needs Correction" branch tag ONLY when needed
function customerStatusBadge(rawStatus) {
  var vis = getCustomerStatus(rawStatus);
  var cls = vis === "Approved" ? "badge-green" : (vis === "Rejected" ? "badge-red" : "badge-blue");
  var html = '<span class="badge ' + cls + '">' + escapeHtml(vis) + '</span>';
  if (rawStatus === "Needs Correction") {
    html += ' <span class="badge badge-yellow">Needs Correction</span>';
  }
  return html;
}

// Validation/State check `isAiEnabled`: Evaluates condition (is ai enabled) and returns status.
function isAiEnabled() {
  return Boolean(getSystemSettings().ai_enabled);
}

// Helper function `setAiEnabled` (params: val): Executes portal workflow logic for `setAiEnabled`.
function setAiEnabled(val) {
  var s = getSystemSettings();
  s.ai_enabled = Boolean(val);
  saveSystemSettings(s);
}

// Validation/State check `isMaintenanceOn`: Evaluates condition (is maintenance on) and returns status.
function isMaintenanceOn() {
  return Boolean(getSystemSettings().maintenance_mode);
}

// Helper function `setMaintenanceOn` (params: val): Executes portal workflow logic for `setMaintenanceOn`.
function setMaintenanceOn(val) {
  var s = getSystemSettings();
  s.maintenance_mode = Boolean(val);
  saveSystemSettings(s);
}

// Data Accessor `getSiteContent`: Retrieves or refreshes state to get site content.
function getSiteContent() {
  var wc = getWebsiteContent();
  var plans = getActivePlans();
  return {
    logo_image: wc.logo_image || DEFAULT_CONTENT.logo_image || "logo.png",
    home_slides: wc.hero_slides || DEFAULT_CONTENT.hero_slides,
    about_slides: wc.about_slides || DEFAULT_CONTENT.about_slides,
    client_images: wc.client_images || DEFAULT_CONTENT.client_images,
    vehicle_images: wc.vehicle_images || DEFAULT_CONTENT.vehicle_images,
    permit_images: wc.permit_images || DEFAULT_CONTENT.permit_images,
    asset_library: wc.asset_library || DEFAULT_CONTENT.asset_library,
    about_lead: (wc.about && wc.about.mission) || DEFAULT_CONTENT.about.mission,
    about_story_1: (wc.about && wc.about.story) || DEFAULT_CONTENT.about.story,
    about_story_2: (wc.about && wc.about.story2) || DEFAULT_CONTENT.about.story2,
    contact_email: wc.contact_email || "support@pigem.com",
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

// Action Handler `saveSiteContent` (params: c): Validates user input and commits state changes to save site content.
function saveSiteContent(c) {
  var wc = getWebsiteContent();
  if (c.logo_image) wc.logo_image = c.logo_image;
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

// Helper function `requireLogin` (params: roles): Executes portal workflow logic for `requireLogin`.
async function requireLogin(roles) {
  return await checkPageAccess(roles);
}

// Helper function `signOutAndGoLogin`: Executes portal workflow logic for `signOutAndGoLogin`.
async function signOutAndGoLogin() {
  var page = getLoginPage();
  await dbSignOut();
  window.location.href = page;
}

// ============================================================
// Masking, Secured One-Time OTP (5-Min Expiry) & 3-Tab Recovery Helpers
// ============================================================

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
  var qDigits = q.replace(/\D/g, "");

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
    } else if (qDigits.length >= 10) {
      var pRes = await supabaseClient.from("applications").select("*").eq("phone", qDigits).order("created_at", { ascending: false }).limit(1);
      if (pRes.data && pRes.data.length > 0) {
        matchedApp = pRes.data[0];
        var ueRes = await supabaseClient.from("users").select("*").eq("email", String(matchedApp.email || "").toLowerCase()).maybeSingle();
        if (ueRes.data) matchedUser = ueRes.data;
      }
    } else {
      var unRes = await supabaseClient.from("users").select("*").ilike("username", qLower).maybeSingle();
      if (unRes.data) matchedUser = unRes.data;
      if (!matchedUser) {
        var fnRes = await supabaseClient.from("users").select("*").ilike("full_name", qLower).limit(1);
        if (fnRes.data && fnRes.data.length > 0) matchedUser = fnRes.data[0];
      }
      if (matchedUser && matchedUser.email) {
        var appByE = await supabaseClient.from("applications").select("*").eq("email", matchedUser.email).order("created_at", { ascending: false }).limit(1);
        if (appByE.data && appByE.data.length > 0) matchedApp = appByE.data[0];
      }
    }
  }

  if (!matchedUser && !matchedApp) {
    var allApps = await dbListAllApplications();
    for (var j = 0; j < allApps.length; j++) {
      var a = allApps[j];
      var aPhone = String(a.phone || "").replace(/\D/g, "");
      if (
        String(a.email || "").toLowerCase() === qLower ||
        (qDigits.length >= 10 && aPhone === qDigits) ||
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

// Database/Storage helper `dbStartPasswordReset` (params: email): Performs cloud Supabase operation to start password reset.
async function dbStartPasswordReset(email) {
  var info = await dbFindAccountForRecovery(email, "password");
  return info.code;
}

// Database/Storage helper `dbFinishPasswordReset` (params: email, code, newPw): Performs cloud Supabase operation to finish password reset.
async function dbFinishPasswordReset(email, code, newPw) {
  if (!newPw || newPw.length < 6) throw new Error("Password must be at least 6 characters.");
  var clean = String(email || "").trim().toLowerCase();
  var cleanCode = String(code || "").trim();
  var users = getDemoUsers();
  var updatedLocal = false;

  for (var i = 0; i < users.length; i++) {
    if (users[i].email === clean) {
      if (users[i].reset_code && users[i].reset_code !== cleanCode) {
        throw new Error("Invalid 6-digit verification code.");
      }
      users[i].password = newPw;
      users[i].activated = true;
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
      await supabaseClient.from("users").update({
        activated: true,
        activation_code: "PW:" + newPw
      }).eq("email", clean);

      // Sync to local cache as well so sign-in is instant
      if (!updatedLocal) {
        users.push({
          id: existing.data.id,
          username: existing.data.username || (await dbGenerateUniqueUsername(existing.data.full_name || clean, clean)),
          email: clean,
          password: newPw,
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

// Database/Storage helper `dbListAllApplications`: Performs cloud Supabase operation to list all applications.
async function dbListAllApplications() {
  if (IS_DEMO_MODE) {
    return ensureDemoSeedApps();
  }
  var list = await dbListApplications(null);
  return list.map(normalizeAppRecord);
}

// Database/Storage helper `dbListApplicationsForCustomer` (params: email): Performs cloud Supabase operation to list applications for customer.
async function dbListApplicationsForCustomer(email) {
  var all = await dbListAllApplications();
  var clean = String(email || "").trim().toLowerCase();
  return all.filter(function (a) { return String(a.email || "").toLowerCase() === clean; });
}

// Database/Storage helper `dbUploadIdPhoto` (params: file, label): Performs cloud Supabase operation to upload id photo.
async function dbUploadIdPhoto(file, label) {
  return await dbUploadDocument(file, "ids", label || "id");
}

// Database/Storage helper `dbListNotifications` (params: email, role): Performs cloud Supabase operation to list notifications.
async function dbListNotifications(email, role) {
  var u = await dbGetCurrentUser();
  var list = await dbListMyNotifications(u || { id: "", email: email, role: role });
  return list.map(function (n) {
    return {
      id: n.id,
      title: n.title || n.subject || "Notification",
      message: n.message || n.body || "",
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

// Database/Storage helper `dbListAiLogs` (params: appId): Performs cloud Supabase operation to list ai logs.
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

// Database/Storage helper `dbAddLog` (params: actorEmail, actionText): Performs cloud Supabase operation to add log.
async function dbAddLog(actorEmail, actionText) {
  await dbAddActivity(actionText, actorEmail);
}

// Database/Storage helper `dbListLogs`: Performs cloud Supabase operation to list logs.
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

// Database/Storage helper `dbRecordProviderUpdate` (params: appId, providerRef, providerStatus, providerRemark, customerInstruction): Records a provider validation or encoding event in public.provider_updates.
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

// Database/Storage helper `dbListProviderUpdates` (params: appId): Lists recorded provider validation updates for an application.
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

// Database/Storage helper `dbCreateAgentLink` (params: agentEmail, note): Performs cloud Supabase operation to create agent link.
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

// Private One-Time Agent Registration Link Generator (for Manager & Admin)
async function dbCreateAgentInviteLink(creatorEmail, note) {
  var randPart = Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  var code = "INV-" + randPart;
  var item = {
    code: code,
    agent_email: creatorEmail || "manager@pigem.ph",
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

// Verify that a Private One-Time Agent Registration Link (`?invite=INV-...`) is valid and active
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

// Consume a Private One-Time Agent Registration Link after the Agent completes registration
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

// Database/Storage helper `dbListAgentLinks`: Performs cloud Supabase operation to list agent links.
async function dbListAgentLinks() {
  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("agent_links").select("*").order("created_at", { ascending: false });
    if (res.data && res.data.length > 0) return res.data;
  }
  return readSaved("pigem_agent_links", [
    { code: "REF-CAV01", agent_email: "agent@demo.test", note: "Dasmariñas Walk-in Desk", created_at: new Date(Date.now() - 86400000).toISOString() }
  ]);
}

// Database/Storage helper `dbListUsers`: Performs cloud Supabase operation to list users.
async function dbListUsers() {
  return await dbListProfiles();
}

// Database/Storage helper `dbGetUsers`: Performs cloud Supabase operation to get users.
async function dbGetUsers() {
  return await dbListProfiles();
}

// Database/Storage helper `dbHasAdminAccount`: Performs cloud Supabase operation to has admin account.
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

// Database/Storage helper `dbCreateUserAccount` (params: fullName, email, password, role, username): Provisions an Admin, Manager, Agent, or Customer account with a unique username.
async function dbCreateUserAccount(fullName, email, password, role, username) {
  var cleanEmail = email.trim().toLowerCase();
  var targetRole = role || "agent";
  var cleanUsername = String(username || "").trim().toLowerCase();

  if (targetRole === "customer") {
    if (typeof isCustomerGmail === "function" && !isCustomerGmail(cleanEmail)) {
      throw new Error("Customer accounts must use a valid @gmail.com email address.");
    }
  } else {
    if (typeof isStaffBusinessEmail === "function" && !isStaffBusinessEmail(cleanEmail)) {
      throw new Error("Internal Agent, Manager, and Admin accounts must use an official internal email (such as name@pigem.ph), not a Gmail address.");
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
    cleanUsername = await dbGenerateUniqueUsername(fullName, cleanEmail);
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
    var existing = await supabaseClient.from("users").select("*").eq("email", cleanEmail).maybeSingle();
    if (existing.data) throw new Error("Account email is already registered in the database.");

    // Internal business accounts (@pigem.com) authenticate via SHA-256 credential hash in public.users
    // without triggering external GoTrue confirmation emails or replacing the Admin's active browser session.
    if (targetRole === "customer") {
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
      active: true,
      activated: true,
      activation_code: "PW:" + pwHash
    };
    var upRes = await supabaseClient.from("users").upsert(dbRow, { onConflict: "email" });
    if (upRes.error) throw new Error(upRes.error.message);
  } else {
    if (findDemoUserByEmail(cleanEmail)) throw new Error("Account email is already registered.");
  }

  var u = {
    id: userId,
    username: cleanUsername,
    email: cleanEmail,
    password_hash: pwHash,
    full_name: fullName,
    role: targetRole,
    active: true,
    activated: true,
    activation_code: "PW:" + pwHash
  };
  var filtered = users.filter(function (x) { return x.email !== cleanEmail; });
  filtered.push(u);
  writeSaved("pigem_users", filtered);
  await dbAddActivity("user_registered", fullName + " (@" + cleanUsername + " / " + cleanEmail + " - " + targetRole + ")");
  return u;
}

// Database/Storage helper `dbAdminResetUserPassword` (params: userId, newPassword): Performs cloud Supabase operation to admin reset user password.
async function dbAdminResetUserPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("New password must be at least 6 characters.");
  }
  var pwHash = await hashPassword(newPassword);
  if (!IS_DEMO_MODE && supabaseClient) {
    var res = await supabaseClient.from("users").update({
      activated: true,
      activation_code: "PW:" + pwHash
    }).eq("id", userId).select("*").single();
    if (res.error) throw new Error(res.error.message);
  }
  var users = getDemoUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === userId) {
      users[i].password_hash = pwHash;
      delete users[i].password;
      users[i].activation_code = "PW:" + pwHash;
    }
  }
  writeSaved("pigem_users", users);
  return true;
}

// Database/Storage helper `dbUpdateUser` (params: userId, changes): Performs cloud Supabase operation to update user.
async function dbUpdateUser(userId, changes) {
  return await dbUpdateProfile(userId, changes);
}

// ============================================================
// 8. Live Supabase Sync for Website Content, Plans, Settings & Bucket Assets
// ============================================================

async function dbSaveLiveWebsiteContent(content) {
  if (IS_DEMO_MODE || !supabaseClient) return;
  try {
    await supabaseClient.from("website_content").upsert({
      id: "main",
      data: content,
      updated_at: new Date().toISOString()
    });
  } catch (e) {}
}

// Database/Storage helper `dbSaveLivePlans` (params: plans): Performs cloud Supabase operation to save live plans.
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

// Database/Storage helper `dbSaveLiveSystemSettings` (params: settings): Performs cloud Supabase operation to save live system settings.
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

// Upload a banner, logo, client logo, vehicle photo, or permit image to the `website-assets` bucket
// and keep it saved in website_content.asset_library[category] so the Manager can switch between saved images anytime!
async function dbUploadWebsiteAsset(file, category) {
  if (!file) throw new Error("Please select an image file first.");
  var folder = category || "Banners";
  var savedPath = "";

  if (IS_DEMO_MODE || !supabaseClient) {
    savedPath = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else {
    var cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    var path = folder + "/" + Date.now() + "-" + cleanName;
    var res = await supabaseClient.storage.from("website-assets").upload(path, file, { upsert: true });
    if (res.error) throw new Error(res.error.message);
    savedPath = path;
  }

  var wc = getWebsiteContent();
  wc.asset_library = wc.asset_library || {};
  wc.asset_library[folder] = wc.asset_library[folder] || [];
  if (wc.asset_library[folder].indexOf(savedPath) === -1) {
    wc.asset_library[folder].unshift(savedPath);
  }
  saveWebsiteContent(wc);
  await dbAddActivity("website_asset_uploaded", folder + ": " + file.name);
  return savedPath;
}

// Sync live Supabase website_content, plans, and system_settings into localStorage on page load
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
    if (wcRes.data && wcRes.data.data && Object.keys(wcRes.data.data).length > 0) {
      writeSaved("pigem_website_content", wcRes.data.data);
    }

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

// Notify both Agents and Managers when Auto-Screening is unavailable and original ID copy is used
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

// Event Listener: Runs initialization or state sync when `DOMContentLoaded` fires
document.addEventListener("DOMContentLoaded", function () {
  dbSyncLiveSettingsAndContent();
});

// Helper function `apiCheckIdPhoto` (params: file, details): Executes portal workflow logic for `apiCheckIdPhoto`.
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
