// ---- Histórico Persistente com IndexedDB ----
// Armazena chat_history + agent_history com TTL implícito

const DB_NAME = "mangaba-ai";
const DB_VERSION = 2;
const STORE_CHAT = "chat_history";
const STORE_AGENT = "agent_history";
const STORE_MEMORY = "memory";
const MAX_HISTORY = 100;
const HISTORY_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MAX_MEMORIES = 50; // fatos de longo prazo: poucos e úteis, sem TTL (persistem até o usuário apagar)

let db = null;

async function initDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(new Error("Falha ao abrir IndexedDB"));
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };

    req.onupgradeneeded = (e) => {
      const database = e.target.result;

      // Chat history: {id, role, content, ts}
      if (!database.objectStoreNames.contains(STORE_CHAT)) {
        const store = database.createObjectStore(STORE_CHAT, { keyPath: "id" });
        store.createIndex("ts", "ts", { unique: false });
      }

      // Agent history: {id, task, result, ts}
      if (!database.objectStoreNames.contains(STORE_AGENT)) {
        const store = database.createObjectStore(STORE_AGENT, { keyPath: "id" });
        store.createIndex("ts", "ts", { unique: false });
      }

      // Memória de longo prazo: {key, value, ts} — fatos que o agente aprendeu
      // e reaproveita entre tarefas diferentes (ex.: "nome exato de um grupo").
      if (!database.objectStoreNames.contains(STORE_MEMORY)) {
        const store = database.createObjectStore(STORE_MEMORY, { keyPath: "key" });
        store.createIndex("ts", "ts", { unique: false });
      }
    };
  });
}

async function addChatMessage(role, content) {
  await initDB();
  const tx = db.transaction([STORE_CHAT], "readwrite");
  const store = tx.objectStore(STORE_CHAT);

  const msg = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2),
    role,
    content,
    ts: Date.now()
  };

  return new Promise((resolve, reject) => {
    const req = store.add(msg);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(msg);

    // Limpar se exceder MAX_HISTORY
    cleanupOldRecords();
  });
}

async function addAgentResult(task, result) {
  await initDB();
  const tx = db.transaction([STORE_AGENT], "readwrite");
  const store = tx.objectStore(STORE_AGENT);

  const record = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2),
    task,
    result: String(result).slice(0, 1000),
    ts: Date.now()
  };

  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(record);
    cleanupOldRecords();
  });
}

async function getChatHistory() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHAT], "readonly");
    const store = tx.objectStore(STORE_CHAT);
    const index = store.index("ts");

    const req = index.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const msgs = req.result || [];
      // Retornar apenas últimas MAX_HISTORY mensagens
      resolve(msgs.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content })));
    };
  });
}

async function getAgentHistory() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_AGENT], "readonly");
    const store = tx.objectStore(STORE_AGENT);
    const index = store.index("ts");

    const req = index.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const records = req.result || [];
      // Retornar últimas 5 tarefas
      resolve(records.slice(-5).map(r => ({
        task: r.task.slice(0, 100),
        result: r.result.slice(0, 200)
      })));
    };
  });
}

async function clearHistory() {
  await initDB();
  const tx = db.transaction([STORE_CHAT, STORE_AGENT], "readwrite");

  return new Promise((resolve, reject) => {
    const req1 = tx.objectStore(STORE_CHAT).clear();
    const req2 = tx.objectStore(STORE_AGENT).clear();

    req1.onerror = req2.onerror = () => reject("Erro ao limpar histórico");
    tx.oncomplete = () => resolve();
  });
}

async function cleanupOldRecords() {
  if (!db) return;

  const cutoff = Date.now() - HISTORY_TTL;
  const tx = db.transaction([STORE_CHAT, STORE_AGENT], "readwrite");

  // Limpar records antigos
  const stores = [STORE_CHAT, STORE_AGENT];
  for (const storeName of stores) {
    const store = tx.objectStore(storeName);
    const index = store.index("ts");
    const range = IDBKeyRange.upperBound(cutoff);

    const req = index.getAll(range);
    req.onsuccess = () => {
      for (const record of req.result) {
        store.delete(record.id);
      }
    };
  }

  // Limpar se exceder MAX_HISTORY
  for (const storeName of stores) {
    const store = tx.objectStore(storeName);
    const req = store.count();
    req.onsuccess = () => {
      if (req.result > MAX_HISTORY) {
        const index = store.index("ts");
        const allReq = index.getAll();
        allReq.onsuccess = () => {
          const records = allReq.result;
          const toDelete = records.slice(0, records.length - MAX_HISTORY);
          for (const record of toDelete) {
            store.delete(record.id);
          }
        };
      }
    };
  }
}

// ---- Memória de longo prazo (fatos entre tarefas diferentes) ----

async function rememberFact(key, value) {
  await initDB();
  const tx = db.transaction([STORE_MEMORY], "readwrite");
  const store = tx.objectStore(STORE_MEMORY);
  const record = { key: String(key).slice(0, 80), value: String(value).slice(0, 500), ts: Date.now() };

  return new Promise((resolve, reject) => {
    const req = store.put(record); // put = upsert: atualiza se a chave já existir
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(record);
    tx.oncomplete = () => cleanupOldMemories();
  });
}

async function forgetFact(key) {
  await initDB();
  const tx = db.transaction([STORE_MEMORY], "readwrite");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE_MEMORY).delete(String(key).slice(0, 80));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function getMemories() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEMORY], "readonly");
    const req = tx.objectStore(STORE_MEMORY).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.ts - a.ts));
  });
}

async function cleanupOldMemories() {
  if (!db) return;
  const tx = db.transaction([STORE_MEMORY], "readwrite");
  const store = tx.objectStore(STORE_MEMORY);
  const req = store.count();
  req.onsuccess = () => {
    if (req.result <= MAX_MEMORIES) return;
    const index = store.index("ts");
    const allReq = index.getAll();
    allReq.onsuccess = () => {
      const excesso = allReq.result.length - MAX_MEMORIES;
      for (const record of allReq.result.slice(0, excesso)) store.delete(record.key); // remove os mais antigos
    };
  };
}
