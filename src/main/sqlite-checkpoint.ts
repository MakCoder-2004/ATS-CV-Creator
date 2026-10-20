import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { ChannelVersions, CheckpointListOptions } from '@langchain/langgraph-checkpoint'
import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple } from '@langchain/langgraph'
import type { RunnableConfig } from '@langchain/core/runnables'

type Configurable = { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
const configurable = (config: RunnableConfig): Configurable => (config.configurable ?? {}) as Configurable

/** Durable LangGraph checkpoint storage backed by the workspace SQLite database. */
export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: SqliteDatabase) {
    super()
    db.exec(`CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
      thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
      parent_checkpoint_id TEXT, checkpoint TEXT NOT NULL, metadata TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id));
      CREATE INDEX IF NOT EXISTS langgraph_checkpoints_latest ON langgraph_checkpoints(thread_id, checkpoint_ns, created_at DESC);
      CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
      thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
      task_id TEXT NOT NULL, write_index INTEGER NOT NULL, channel TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id, task_id, write_index));`)
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const c = configurable(config)
    if (!c.thread_id) return undefined
    const row = c.checkpoint_id
      ? this.db.prepare('SELECT * FROM langgraph_checkpoints WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=?').get(c.thread_id, c.checkpoint_ns ?? '', c.checkpoint_id)
      : this.db.prepare('SELECT * FROM langgraph_checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(c.thread_id, c.checkpoint_ns ?? '')
    if (!row) return undefined
    const saved = row as { thread_id: string; checkpoint_ns: string; checkpoint_id: string; parent_checkpoint_id: string | null; checkpoint: string; metadata: string }
    const rows = this.db.prepare('SELECT task_id,channel,value FROM langgraph_checkpoint_writes WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? ORDER BY task_id,write_index').all(saved.thread_id, saved.checkpoint_ns, saved.checkpoint_id) as Array<{ task_id: string; channel: string; value: string }>
    const resultConfig: RunnableConfig = { configurable: { thread_id: saved.thread_id, checkpoint_ns: saved.checkpoint_ns, checkpoint_id: saved.checkpoint_id } }
    return {
      config: resultConfig,
      checkpoint: JSON.parse(saved.checkpoint) as Checkpoint,
      metadata: JSON.parse(saved.metadata) as CheckpointMetadata,
      ...(saved.parent_checkpoint_id ? { parentConfig: { configurable: { thread_id: saved.thread_id, checkpoint_ns: saved.checkpoint_ns, checkpoint_id: saved.parent_checkpoint_id } } } : {}),
      pendingWrites: rows.map(row => [row.task_id, row.channel, JSON.parse(row.value)])
    }
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const c = configurable(config)
    if (!c.thread_id) return
    const rows = this.db.prepare('SELECT checkpoint_id FROM langgraph_checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY created_at DESC,rowid DESC').all(c.thread_id, c.checkpoint_ns ?? '') as Array<{ checkpoint_id: string }>
    let sent = 0
    for (const row of rows) {
      if (options?.before && configurable(options.before).checkpoint_id === row.checkpoint_id) continue
      const tuple = await this.getTuple({ configurable: { thread_id: c.thread_id, checkpoint_ns: c.checkpoint_ns ?? '', checkpoint_id: row.checkpoint_id } })
      if (!tuple) continue
      if (options?.filter && Object.entries(options.filter).some(([key, value]) => (tuple.metadata as Record<string, unknown>)[key] !== value)) continue
      yield tuple
      if (++sent >= (options?.limit ?? Infinity)) return
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    const c = configurable(config)
    if (!c.thread_id) throw new Error('LangGraph checkpoint requires a thread_id.')
    this.db.prepare(`INSERT OR REPLACE INTO langgraph_checkpoints
      (thread_id,checkpoint_ns,checkpoint_id,parent_checkpoint_id,checkpoint,metadata,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(c.thread_id, c.checkpoint_ns ?? '', checkpoint.id, c.checkpoint_id ?? null, JSON.stringify(checkpoint), JSON.stringify(metadata), Date.now())
    return { configurable: { thread_id: c.thread_id, checkpoint_ns: c.checkpoint_ns ?? '', checkpoint_id: checkpoint.id } }
  }

  async putWrites(config: RunnableConfig, writes: Array<[string, unknown]>, taskId: string): Promise<void> {
    const c = configurable(config)
    if (!c.thread_id || !c.checkpoint_id) throw new Error('LangGraph pending writes require a thread and checkpoint identity.')
    const insert = this.db.prepare(`INSERT OR REPLACE INTO langgraph_checkpoint_writes
      (thread_id,checkpoint_ns,checkpoint_id,task_id,write_index,channel,value) VALUES (?,?,?,?,?,?,?)`)
    const tx = this.db.transaction(() => writes.forEach(([channel, value], index) => insert.run(c.thread_id, c.checkpoint_ns ?? '', c.checkpoint_id, taskId, index, channel, JSON.stringify(value))))
    tx()
  }

  async deleteThread(threadId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM langgraph_checkpoint_writes WHERE thread_id=?').run(threadId)
      this.db.prepare('DELETE FROM langgraph_checkpoints WHERE thread_id=?').run(threadId)
    })
    tx()
  }
}
