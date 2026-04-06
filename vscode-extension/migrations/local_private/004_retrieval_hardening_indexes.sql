CREATE INDEX IF NOT EXISTS idx_files_project_deleted_path ON files(project_id, is_deleted, path);
CREATE INDEX IF NOT EXISTS idx_file_chunks_project_file_chunk ON file_chunks(project_id, file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_file_chunks_file_chunk ON file_chunks(file_id, chunk_index);
