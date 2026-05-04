import { JSOX } from "jsox";

export const DB_NAME = 'req-queue';
export const STORE = 'queue';
export const DB_VERSION = 3; // увеличьте, если меняете схему/индексы

type QueueRecord<T = unknown> = {
  id?: number;
  payload: T;
  enqueuedAt: number;
  locked: boolean;
  lockedAt: number | null;
};

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      // Для предсказуемости пересоздадим стор (в дев-окружении можно просто дропнуть БД из DevTools)
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });

      // Индекс для выборки "незалоченных" по порядку: [locked, id]
      store.createIndex('byLockedId', ['locked', 'id'], { unique: false });
      // Индекс по времени лока — ускоряет снятие просроченных локов
      store.createIndex('byLockedAt', 'lockedAt', { unique: false });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// Вспомогалка
function withTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let done = false;

    const finish = (err?: any, val?: T) => {
      if (done) return;
      done = true;
      err ? reject(err) : resolve(val as T);
    };

    Promise.resolve()
      .then(() => fn(store))
      .then((result) => {
        tx.oncomplete = () => finish(undefined, result);
        tx.onerror = () => finish(tx.error || new Error('Transaction error'));
        tx.onabort = () => finish(tx.error || new Error('Transaction aborted'));
      })
      .catch((e) => {
        try {
          tx.abort();
        } catch { }
        finish(e);
      });
  });
}

// ---------- API ----------

export async function pushOne<T = unknown>(payload: T): Promise<number> {
  const db = await idbOpen();
  try {
    return await withTx<number>(db, 'readwrite', async (store) => {
      const rec: QueueRecord<T> = {
        payload,
        enqueuedAt: Date.now(),
        locked: false,
        lockedAt: null,
      };
      const req = store.add(rec);
      return await new Promise<number>((res, rej) => {
        req.onsuccess = () => res(req.result as number);
        req.onerror = () => rej(req.error);
      });
    });
  } finally {
    db.close();
  }
}

export async function pushMany<T = unknown>(payloads: T[]): Promise<number[]> {
  const db = await idbOpen();
  try {
    return await withTx<number[]>(db, 'readwrite', async (store) => {
      const ids: number[] = [];
      for (const p of payloads) {
        const rec: QueueRecord<T> = {
          payload: p,
          enqueuedAt: Date.now(),
          locked: false,
          lockedAt: null,
        };
        const req = store.add(rec);
        // eslint-disable-next-line no-await-in-loop
        const id = await new Promise<number>((res, rej) => {
          req.onsuccess = () => res(req.result as number);
          req.onerror = () => rej(req.error);
        });
        ids.push(id);
      }
      return ids;
    });
  } finally {
    db.close();
  }
}

export async function size(): Promise<number> {
  const db = await idbOpen();
  try {
    return await withTx<number>(db, 'readonly', async (store) => {
      const req = store.count();
      return await new Promise<number>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    });
  } finally {
    db.close();
  }
}

export async function peek<T = unknown>(limit = 50): Promise<Array<QueueRecord<T>>> {
  const db = await idbOpen();
  try {
    return await withTx<Array<QueueRecord<T>>>(db, 'readonly', async (store) => {
      const result: Array<QueueRecord<T>> = [];
      const idx = store.index('byLockedId');
      const range = IDBKeyRange.bound([false, -Infinity], [false, Infinity]);
      return await new Promise<Array<QueueRecord<T>>>((res, rej) => {
        const curReq = idx.openCursor(range, 'next');
        curReq.onerror = () => rej(curReq.error);
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (!cursor || result.length >= limit) return res(result);
          result.push(cursor.value as QueueRecord<T>);
          cursor.continue();
        };
      });
    });
  } finally {
    db.close();
  }
}

// Снять просроченные блокировки (visibility timeout)
async function unlockExpired(store: IDBObjectStore, cutoff: number): Promise<void> {
  const idx = store.index('byLockedAt');
  // lockedAt < cutoff
  const range = IDBKeyRange.upperBound(cutoff, true);
  await new Promise<void>((res, rej) => {
    const curReq = idx.openCursor(range);
    curReq.onerror = () => rej(curReq.error);
    curReq.onsuccess = () => {
      const cursor = curReq.result;
      if (!cursor) return res();
      const rec = cursor.value as QueueRecord;
      if (rec.locked && typeof rec.lockedAt === 'number' && rec.lockedAt < cutoff) {
        rec.locked = false;
        rec.lockedAt = null;
        const putReq = cursor.update(rec);
        putReq.onerror = () => rej(putReq.error);
        putReq.onsuccess = () => cursor.continue();
      } else {
        cursor.continue();
      }
    };
  });
}

export async function claimBatch<T = unknown>(
  limit = 50,
  lockMs = 5 * 60_000 // 5 минут
): Promise<Array<QueueRecord<T>>> {
  const now = Date.now();
  const cutoff = now - lockMs;
  const db = await idbOpen();
  try {
    return await withTx<Array<QueueRecord<T>>>(db, 'readwrite', async (store) => {
      // 1) освободим протухшие лизы
      await unlockExpired(store, cutoff);

      // 2) залочим первые N незалоченных по порядку
      const idx = store.index('byLockedId');
      const range = IDBKeyRange.bound([false, -Infinity], [false, Infinity]);
      const claimed: Array<QueueRecord<T>> = [];

      await new Promise<void>((res, rej) => {
        const curReq = idx.openCursor(range, 'next');
        curReq.onerror = () => rej(curReq.error);
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (!cursor || claimed.length >= limit) return res();

          const rec = cursor.value as QueueRecord<T>;
          rec.locked = true;
          rec.lockedAt = now;
          const putReq = cursor.update(rec);
          putReq.onerror = () => rej(putReq.error);
          putReq.onsuccess = () => {
            claimed.push(rec);
            cursor.continue();
          };
        };
      });

      return claimed;
    });
  } finally {
    db.close();
  }
}

export async function ack(ids: Array<number>): Promise<void> {
  if (!ids.length) return;
  const db = await idbOpen();
  try {
    await withTx<void>(db, 'readwrite', async (store) => {
      for (const id of ids) {
        const req = store.delete(id);
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((res, rej) => {
          req.onsuccess = () => res();
          req.onerror = () => rej(req.error);
        });
      }
    });
  } finally {
    db.close();
  }
}

export async function nack(ids: Array<number>): Promise<void> {
  if (!ids.length) return;
  const db = await idbOpen();
  try {
    await withTx<void>(db, 'readwrite', async (store) => {
      for (const id of ids) {
        const getReq = store.get(id);
        // eslint-disable-next-line no-await-in-loop
        const rec = await new Promise<QueueRecord | undefined>((res, rej) => {
          getReq.onsuccess = () => res(getReq.result as QueueRecord | undefined);
          getReq.onerror = () => rej(getReq.error);
        });
        if (!rec) continue;
        rec.locked = false;
        rec.lockedAt = null;
        const putReq = store.put(rec);
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((res, rej) => {
          putReq.onsuccess = () => res();
          putReq.onerror = () => rej(putReq.error);
        });
      }
    });
  } finally {
    db.close();
  }
}

export async function dumpAll<T = unknown>(full = false): Promise<Array<T | QueueRecord<T>>> {
  const db = await idbOpen();
  try {
    return await withTx<Array<T | QueueRecord<T>>>(db, 'readonly', async (store) => {
      // getAll поддерживается в современных браузерах; если нужна совместимость — замените на курсор
      const req = store.getAll();
      return await new Promise((res, rej) => {
        req.onsuccess = () => {
          const arr = req.result as Array<QueueRecord<T>>;
          res(full ? arr : arr.map((r) => r.payload));
        };
        req.onerror = () => rej(req.error);
      });
    });
  } finally {
    db.close();
  }
}

export async function loadFromArray<T = unknown>(payloads: T[]): Promise<number[]> {
  return pushMany(payloads);
}

// Утилита: забирает пачками, вызывает обработчик, подтверждает/возвращает
export async function drain<T = unknown>(
  handler: (payloads: T[], records: Array<QueueRecord<T>>) => Promise<void> | void,
  opts?: { batchSize?: number; lockMs?: number; stopOnEmpty?: boolean }
): Promise<void> {
  const batchSize = opts?.batchSize ?? 50;
  const lockMs = opts?.lockMs ?? 5 * 60_000;
  const stopOnEmpty = opts?.stopOnEmpty ?? true;

  // Простой цикл; можно запускать периодически из SW/таймера
  while (true) {
    const batch = await claimBatch<T>(batchSize, lockMs);
    if (batch.length === 0) {
      if (stopOnEmpty) return;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const ids = batch.map((r) => r.id!) as number[];
    try {
      await handler(batch.map((r) => r.payload), batch);
      await ack(ids);
    } catch (e) {
      // обработчик упал — вернём в очередь
      await nack(ids);
      throw e; // либо логируйте и продолжайте
    }
  }
}

// Вернуть все записи и полностью очистить store
export async function dumpAndClear<T = unknown>(full = false): Promise<Array<T | QueueRecord<T>>> {
  const db = await idbOpen();
  try {
    return await withTx<Array<T | QueueRecord<T>>>(db, 'readwrite', async (store) => {
      // читаем всё
      const all = await new Promise<Array<QueueRecord<T>>>((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result as Array<QueueRecord<T>>);
        req.onerror = () => rej(req.error);
      });

      // очищаем стор
      await new Promise<void>((res, rej) => {
        const req = store.clear();
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      });

      return full ? all : all.map((r) => r.payload);
    });
  } finally {
    db.close();
  }
}

// Вернуть и удалить только незалоченные записи (сохраняя залоченные)
export async function popAllUnlocked<T = unknown>(full = false): Promise<Array<T | QueueRecord<T>>> {
  const db = await idbOpen();
  try {
    return await withTx<Array<T | QueueRecord<T>>>(db, 'readwrite', async (store) => {
      const out: Array<QueueRecord<T>> = [];
      const idx = store.index('byLockedId');
      const range = IDBKeyRange.bound([false, -Infinity], [false, Infinity]); // locked=false

      await new Promise<void>((res, rej) => {
        const curReq = idx.openCursor(range, 'next');
        curReq.onerror = () => rej(curReq.error);
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (!cursor) return res();
          const rec = cursor.value as QueueRecord<T>;
          out.push(rec);

          const delReq = cursor.delete(); // удаляем эту запись
          delReq.onerror = () => rej(delReq.error);
          delReq.onsuccess = () => cursor.continue();
        };
      });

      return full ? out : out.map((r) => r.payload);
    });
  } finally {
    db.close();
  }
}

// Remove old items from queue
export async function prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const db = await idbOpen();
  try {
    return await withTx<number>(db, 'readwrite', async (store) => {
      let count = 0;
      const req = store.openCursor();
      await new Promise<void>((res, rej) => {
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return res();
          const rec = cursor.value as QueueRecord;
          if (rec.enqueuedAt < cutoff) {
            cursor.delete();
            count++;
          }
          cursor.continue();
        };
        req.onerror = () => rej(req.error);
      });
      return count;
    });
  } finally {
    db.close();
  }
}

// Remove duplicate payloads from queue
export async function deduplicate(): Promise<number> {
    const db = await idbOpen();
    try {
        return await withTx<number>(db, 'readwrite', async (store) => {
            const hashes = new Set<string>();
            let count = 0;
            const req = store.openCursor();
             await new Promise<void>((res, rej) => {
                req.onsuccess = () => {
                   const cursor = req.result;
                   if (!cursor) return res();
                   const rec = cursor.value as QueueRecord;
                   try {
                       const hash = JSOX.stringify(rec.payload);
                       if (hashes.has(hash)) {
                           cursor.delete();
                           count++;
                       } else {
                           hashes.add(hash);
                       }
                   } catch (e) {
                       // ignore serialization errors
                   }
                   cursor.continue();
                };
                req.onerror = () => rej(req.error);
             });
             return count;
        });
    } finally {
        db.close();
    }
}
