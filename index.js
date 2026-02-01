import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';
import cors from 'cors';
import { crawlAllCampaigns, crawlSingleCampaign, fetchPlaceRank, fetchPlaceInfo } from './crawl.js';
import { supabase } from './supabase.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // CORS 허용

const PORT = process.env.PORT || 3000;
const CRAWL_HOUR = process.env.CRAWL_HOUR || '14';
const CRAWL_MINUTE = process.env.CRAWL_MINUTE || '0';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Seoul';

// ============================================
// API 엔드포인트
// ============================================

// 헬스체크
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'RACAN Place Rank Crawler',
    time: new Date().toISOString(),
    timezone: TIMEZONE,
    nextCrawl: `${CRAWL_HOUR}:${CRAWL_MINUTE.padStart(2, '0')} ${TIMEZONE}`,
  });
});

// 헬스체크 (Railway용)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// 플레이스 정보 조회 (URL에서 MID 추출 후 정보 가져오기)
app.get('/place/info/:mid', async (req, res) => {
  try {
    const { mid } = req.params;
    console.log(`[API] 플레이스 정보 조회: ${mid}`);
    const info = await fetchPlaceInfo(mid);
    res.json(info);
  } catch (error) {
    console.error('[ERROR] 플레이스 정보 조회 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 수동 크롤링 트리거 (전체)
app.post('/crawl/all', async (req, res) => {
  try {
    console.log('[MANUAL] 전체 크롤링 시작...');
    const result = await crawlAllCampaigns();
    res.json({ success: true, result });
  } catch (error) {
    console.error('[ERROR] 전체 크롤링 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 단일 캠페인 크롤링
app.post('/crawl/campaign/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();
    
    if (error || !campaign) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    }
    
    console.log(`[MANUAL] 단일 크롤링 시작: ${campaign.company}`);
    const result = await crawlSingleCampaign(campaign);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] 단일 크롤링 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 크롤링 상태 조회
app.get('/status', async (req, res) => {
  try {
    const { count: activeCount } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('category', 'place');

    const { data: recentHistory } = await supabase
      .from('campaign_rank_history')
      .select('checked_at')
      .order('checked_at', { ascending: false })
      .limit(1);

    res.json({
      activeCampaigns: activeCount || 0,
      lastCrawl: recentHistory?.[0]?.checked_at || null,
      scheduledTime: `${CRAWL_HOUR}:${CRAWL_MINUTE.padStart(2, '0')} ${TIMEZONE}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Cron 스케줄러 설정
// ============================================

// 매일 지정 시간에 전체 크롤링 실행
const cronExpression = `${CRAWL_MINUTE} ${CRAWL_HOUR} * * *`;

cron.schedule(cronExpression, async () => {
  console.log(`[CRON] ===== 스케줄 크롤링 시작 (${new Date().toISOString()}) =====`);
  
  try {
    const result = await crawlAllCampaigns();
    console.log('[CRON] 스케줄 크롤링 완료:', result);
  } catch (error) {
    console.error('[CRON] 스케줄 크롤링 실패:', error);
  }
}, {
  timezone: TIMEZONE,
});

console.log(`[CRON] 스케줄 설정 완료: 매일 ${CRAWL_HOUR}:${CRAWL_MINUTE.padStart(2, '0')} (${TIMEZONE})`);

// ============================================
// 서버 시작
// ============================================

app.listen(PORT, () => {
  console.log(`[SERVER] RACAN Place Rank Crawler 실행 중 (포트: ${PORT})`);
  console.log(`[SERVER] 환경:`);
  console.log(`  - 타임존: ${TIMEZONE}`);
  console.log(`  - 크롤링 시간: ${CRAWL_HOUR}:${CRAWL_MINUTE.padStart(2, '0')}`);
  console.log(`  - 프록시: ${process.env.PROXY_URL ? '설정됨' : '미설정'}`);
});
