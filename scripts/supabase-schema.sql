-- ===================================================================
-- Slack HUB - Supabase 테이블 스키마
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행
-- ===================================================================

-- 기존 테이블 제거 (안전한 재실행을 위해)
-- ⚠️ 이미 데이터가 있으면 모두 삭제됨!
DROP TABLE IF EXISTS slack_messages CASCADE;
DROP TABLE IF EXISTS titles CASCADE;
DROP TABLE IF EXISTS sync_meta CASCADE;

-- pg_trgm extension (부분검색용 — 먼저 활성화)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) 메시지 + 답글 통합 테이블
CREATE TABLE slack_messages (
  -- 기본 키
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Slack 원본 정보 (dedup 키)
  slack_permalink TEXT UNIQUE NOT NULL,
  is_reply BOOLEAN NOT NULL DEFAULT false,

  -- 메시지 메타
  channel TEXT,
  sender TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,   -- KST 기준 Date+Time 합쳐서

  -- 콘텐츠
  message TEXT,

  -- 답글 정보
  parent_message TEXT,
  parent_link TEXT,

  -- 이미지
  image_urls JSONB DEFAULT '[]'::jsonb,            -- 공개 Supabase URL 배열
  image_count INTEGER DEFAULT 0,
  image_sizes_mb NUMERIC(10, 2),                    -- 모든 이미지 합산

  -- AI 분류
  category TEXT,
  sub_category TEXT,

  -- 작품 매칭
  title_number TEXT,
  title_name TEXT,
  title_match TEXT,                                 -- 정확/이름매칭/번호매칭/유사/없음

  -- 운영용
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now()  -- 마지막 동기화 시각
);

-- 2) 인덱스 (대시보드 쿼리 빠르게)
CREATE INDEX idx_slack_messages_created_at ON slack_messages(created_at DESC);
CREATE INDEX idx_slack_messages_title_number ON slack_messages(title_number);
CREATE INDEX idx_slack_messages_category ON slack_messages(category);
CREATE INDEX idx_slack_messages_is_reply ON slack_messages(is_reply);
CREATE INDEX idx_slack_messages_title_name_trgm
  ON slack_messages USING gin (title_name gin_trgm_ops);  -- 작품명 부분검색

-- 3) 작품 DB 테이블 (별도)
CREATE TABLE titles (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_titles_name_trgm
  ON titles USING gin (name gin_trgm_ops);

-- 4) 동기화 메타데이터 (마지막 sync 시점 등)
CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ===================================================================
-- 권한 (RLS 비활성 — service_role로만 접근하므로 단순화)
-- ===================================================================
ALTER TABLE slack_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE titles DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_meta DISABLE ROW LEVEL SECURITY;
