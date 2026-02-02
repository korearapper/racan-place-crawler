import axios from 'axios';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { supabase } from './supabase.js';

// ============================================
// 프록시 설정
// ============================================
function getProxyAgent() {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) {
    console.warn('[WARN] PROXY_URL이 설정되지 않았습니다. 프록시 없이 진행합니다.');
    return null;
  }
  return new HttpsProxyAgent(proxyUrl);
}

// 여러 포트 중 랜덤 선택 (로테이션)
function getRandomProxyAgent() {
  const baseUrl = process.env.PROXY_URL;
  if (!baseUrl) return null;
  
  // 포트 범위: 10001-10100 (한국 전용)
  const randomPort = 10001 + Math.floor(Math.random() * 100);
  const rotatedUrl = baseUrl.replace(/:(\d+)$/, `:${randomPort}`);
  
  return new HttpsProxyAgent(rotatedUrl);
}

// ============================================
// 네이버 플레이스 정보 가져오기
// ============================================
export async function fetchPlaceInfo(mid) {
  console.log(`[API] 플레이스 정보 조회 시작: ${mid}`);
  
  try {
    // 방법 1: 네이버 플레이스 상세 페이지에서 JSON 데이터 추출
    const url = `https://m.place.naver.com/place/${mid}/home`;
    const agent = getRandomProxyAgent();
    
    const response = await axios.get(url, {
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: 15000,
    });

    const html = response.data;
    
    // window.__APOLLO_STATE__ 에서 데이터 추출
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    if (apolloMatch) {
      try {
        const apolloData = JSON.parse(apolloMatch[1]);
        // PlaceDetailBase:mid 형태의 키 찾기
        const placeKey = Object.keys(apolloData).find(k => k.startsWith('PlaceDetailBase:'));
        if (placeKey && apolloData[placeKey]) {
          const place = apolloData[placeKey];
          console.log(`[API] Apollo 데이터 발견: ${place.name}`);
          return {
            success: true,
            mid: mid,
            name: place.name || '',
            thumbnail: place.imageUrl || place.thumbnailUrl || '',
            address: place.roadAddress || place.address || '',
            category: place.category || '',
          };
        }
      } catch (e) {
        console.log('[API] Apollo 파싱 실패, 다른 방법 시도');
      }
    }

    // 방법 2: meta 태그에서 추출
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    
    // 제목에서 업체명 추출 (보통 "업체명 : 네이버 플레이스" 형식)
    let name = ogTitle.split(':')[0].split('-')[0].split('|')[0].trim();
    
    if (name) {
      console.log(`[API] OG 태그에서 추출: ${name}`);
      return {
        success: true,
        mid: mid,
        name: name,
        thumbnail: ogImage,
        address: '',
        category: '',
      };
    }

    // 방법 3: HTML에서 직접 추출
    const nameFromHtml = $('span.GHAhO').first().text() || 
                         $('span.place_name').first().text() || 
                         $('h1').first().text() || '';
    
    if (nameFromHtml) {
      console.log(`[API] HTML에서 추출: ${nameFromHtml}`);
      return {
        success: true,
        mid: mid,
        name: nameFromHtml.trim(),
        thumbnail: ogImage,
        address: '',
        category: '',
      };
    }

    console.log('[API] 정보 추출 실패');
    return {
      success: false,
      mid: mid,
      name: '',
      thumbnail: '',
      error: '정보를 가져올 수 없습니다.',
    };

  } catch (error) {
    console.error(`[ERROR] 플레이스 정보 가져오기 실패 (${mid}):`, error.message);
    return {
      success: false,
      mid: mid,
      name: '',
      thumbnail: '',
      error: error.message,
    };
  }
}

// ============================================
// 네이버 플레이스 검색 순위 가져오기 (HTML 파싱, CPC 광고 제외)
// ============================================
export async function fetchPlaceRank(keyword, targetMid) {
  console.log(`[RANK] 순위 검색 시작: 키워드="${keyword}", MID=${targetMid}`);
  
  try {
    // 네이버 지도 검색 페이지
    const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(keyword)}`;
    
    const agent = getRandomProxyAgent();
    const response = await axios.get(searchUrl, {
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: 15000,
    });

    const html = response.data;
    let rank = null;
    let totalCount = 0;

    // __APOLLO_STATE__ 에서 검색 결과 추출
    const apolloMatch = html.match(/__APOLLO_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    
    if (apolloMatch) {
      try {
        const apolloData = JSON.parse(apolloMatch[1]);
        
        // 검색 결과 place 찾기 (SearchList, PlaceSummary 등)
        const placeKeys = Object.keys(apolloData).filter(k => 
          k.startsWith('PlaceSummary:') || k.startsWith('Place:')
        );
        
        console.log(`[RANK] Apollo에서 ${placeKeys.length}개 장소 발견`);
        
        // 광고 제외하고 순서대로 정렬
        const places = placeKeys
          .map(k => apolloData[k])
          .filter(p => !p.isAd && !p.isAdv && !p.ad);
        
        totalCount = places.length;
        
        for (let i = 0; i < places.length; i++) {
          const place = places[i];
          const placeId = String(place.id || place.placeId || '');
          const targetId = String(targetMid);
          
          if (placeId === targetId) {
            rank = i + 1;
            console.log(`[RANK] 발견! 순위: ${rank}, name: ${place.name}`);
            break;
          }
        }
        
        if (!rank && places.length > 0) {
          console.log(`[RANK] MID ${targetMid}를 찾지 못함`);
          places.slice(0, 5).forEach((p, i) => {
            console.log(`[RANK] ${i+1}위: id=${p.id}, name=${p.name}`);
          });
        }
      } catch (e) {
        console.log('[RANK] Apollo 파싱 실패:', e.message);
      }
    }
    
    // Apollo 실패시 정규식으로 ID 추출 시도
    if (rank === null) {
      const idMatches = html.matchAll(/place\/(\d+)/g);
      const foundIds = [...new Set([...idMatches].map(m => m[1]))];
      
      console.log(`[RANK] 정규식으로 ${foundIds.length}개 ID 발견`);
      
      const targetId = String(targetMid);
      const idx = foundIds.indexOf(targetId);
      
      if (idx !== -1) {
        rank = idx + 1;
        console.log(`[RANK] 정규식 매칭 성공! 순위: ${rank}`);
      } else {
        console.log(`[RANK] 처음 5개 ID:`, foundIds.slice(0, 5));
      }
      
      totalCount = foundIds.length;
    }

    return {
      rank: rank,
      totalResults: totalCount,
      checkedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[RANK ERROR] 순위 검색 실패 (${keyword}):`, error.message);
    return {
      rank: null,
      totalResults: 0,
      checkedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

// ============================================
// 단일 캠페인 순위 크롤링
// ============================================
export async function crawlSingleCampaign(campaign) {
  console.log(`[CRAWL] 캠페인 크롤링: ${campaign.company} - ${campaign.keyword}`);
  
  // 순위 조회
  const rankResult = await fetchPlaceRank(campaign.keyword, campaign.mid);
  
  // 순위 히스토리 저장
  const { error: historyError } = await supabase
    .from('campaign_rank_history')
    .insert({
      campaign_id: campaign.id,
      rank: rankResult.rank,
      checked_at: rankResult.checkedAt,
    });

  if (historyError) {
    console.error(`[ERROR] 히스토리 저장 실패:`, historyError);
  }

  // campaigns 테이블의 current_rank, last_rank 업데이트
  const { error: updateError } = await supabase
    .from('campaigns')
    .update({
      last_rank: campaign.current_rank,
      current_rank: rankResult.rank,
      last_rank_checked: rankResult.checkedAt,
    })
    .eq('id', campaign.id);

  if (updateError) {
    console.error(`[ERROR] 캠페인 업데이트 실패:`, updateError);
  }

  console.log(`[CRAWL] 완료: ${campaign.company} - ${campaign.keyword} - 순위: ${rankResult.rank || '순위외'}`);

  return {
    success: true,
    campaignId: campaign.id,
    company: campaign.company,
    keyword: campaign.keyword,
    rank: rankResult.rank,
  };
}

// ============================================
// 전체 진행중 캠페인 크롤링
// ============================================
export async function crawlAllCampaigns() {
  console.log('[CRAWL] ===== 전체 크롤링 시작 =====');
  const startTime = Date.now();

  // 진행중인 place 캠페인만 가져오기
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active')
    .eq('category', 'place');

  if (error) {
    console.error('[ERROR] 캠페인 목록 조회 실패:', error);
    return { success: false, error: error.message };
  }

  console.log(`[CRAWL] 총 ${campaigns.length}개 캠페인 크롤링 예정`);

  const results = {
    total: campaigns.length,
    success: 0,
    failed: 0,
    details: [],
  };

  // 순차적으로 크롤링 (과도한 요청 방지)
  for (let i = 0; i < campaigns.length; i++) {
    const campaign = campaigns[i];
    
    try {
      const result = await crawlSingleCampaign(campaign);
      
      if (result.success) {
        results.success++;
        results.details.push({
          company: campaign.company,
          rank: result.rank,
          status: 'success',
        });
      } else {
        results.failed++;
        results.details.push({
          company: campaign.company,
          status: 'failed',
        });
      }
    } catch (err) {
      results.failed++;
      results.details.push({
        company: campaign.company,
        status: 'error',
        error: err.message,
      });
    }

    // 요청 간격 (2~4초 랜덤)
    if (i < campaigns.length - 1) {
      const delay = 2000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 진행 상황 로그 (10개마다)
    if ((i + 1) % 10 === 0) {
      console.log(`[CRAWL] 진행: ${i + 1}/${campaigns.length}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[CRAWL] ===== 크롤링 완료 =====`);
  console.log(`[CRAWL] 총 ${results.total}개 중 성공: ${results.success}, 실패: ${results.failed}`);
  console.log(`[CRAWL] 소요 시간: ${elapsed}초`);

  return results;
}
