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
export async function fetchPlaceInfo(placeId) {
  const url = `https://pcmap.place.naver.com/place/${placeId}/home`;
  
  try {
    const agent = getRandomProxyAgent();
    const response = await axios.get(url, {
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    
    // JSON-LD 스크립트에서 정보 추출
    let placeData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const json = JSON.parse($(el).html());
        if (json['@type'] === 'LocalBusiness' || json.name) {
          placeData = json;
        }
      } catch (e) {}
    });

    if (placeData) {
      return {
        name: placeData.name || '',
        address: placeData.address?.streetAddress || '',
        telephone: placeData.telephone || '',
        image: placeData.image || '',
        url: `https://map.naver.com/p/entry/place/${placeId}`,
      };
    }

    // 대안: HTML에서 직접 추출
    const name = $('span.GHAhO').first().text() || $('h2.place_name').text();
    const address = $('span.LDgIH').first().text();
    
    return {
      name: name || `Place ${placeId}`,
      address: address || '',
      telephone: '',
      image: '',
      url: `https://map.naver.com/p/entry/place/${placeId}`,
    };

  } catch (error) {
    console.error(`[ERROR] 플레이스 정보 가져오기 실패 (${placeId}):`, error.message);
    return null;
  }
}

// ============================================
// 네이버 플레이스 검색 순위 가져오기
// ============================================
export async function fetchPlaceRank(keyword, targetPlaceId) {
  // 네이버 지도 검색 API (비공식)
  const searchUrl = `https://map.naver.com/p/api/search/allSearch`;
  
  try {
    const agent = getRandomProxyAgent();
    const response = await axios.get(searchUrl, {
      httpsAgent: agent,
      params: {
        query: keyword,
        type: 'all',
        searchCoord: '126.9783882;37.5666103', // 서울 중심 좌표
        boundary: '',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://map.naver.com/',
      },
      timeout: 15000,
    });

    const data = response.data;
    
    // 플레이스 검색 결과에서 순위 찾기
    let rank = null;
    let totalCount = 0;

    if (data?.result?.place?.list) {
      const places = data.result.place.list;
      totalCount = places.length;
      
      for (let i = 0; i < places.length; i++) {
        const place = places[i];
        // ID 비교 (여러 필드 체크)
        if (place.id === targetPlaceId || 
            place.placeId === targetPlaceId ||
            String(place.id) === String(targetPlaceId)) {
          rank = i + 1;
          break;
        }
      }
    }

    return {
      rank: rank,
      totalResults: totalCount,
      checkedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[ERROR] 순위 검색 실패 (${keyword}):`, error.message);
    return {
      rank: null,
      totalResults: 0,
      checkedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

// ============================================
// 단일 업체 크롤링
// ============================================
export async function crawlSingleShop(shopId) {
  console.log(`[CRAWL] 업체 크롤링 시작: ${shopId}`);
  
  // DB에서 업체 정보 가져오기
  const { data: shop, error } = await supabase
    .from('place_shops')
    .select('*')
    .eq('id', shopId)
    .single();

  if (error || !shop) {
    console.error(`[ERROR] 업체 조회 실패: ${shopId}`, error);
    return { success: false, error: '업체를 찾을 수 없습니다.' };
  }

  // 순위 조회
  const rankResult = await fetchPlaceRank(shop.keyword, shop.place_id);
  
  // 순위 히스토리 저장
  const { error: historyError } = await supabase
    .from('place_rank_history')
    .insert({
      shop_id: shopId,
      rank: rankResult.rank,
      keyword: shop.keyword,
      checked_at: rankResult.checkedAt,
    });

  if (historyError) {
    console.error(`[ERROR] 히스토리 저장 실패:`, historyError);
  }

  // 업체 테이블의 current_rank, last_rank 업데이트
  const { error: updateError } = await supabase
    .from('place_shops')
    .update({
      last_rank: shop.current_rank,
      current_rank: rankResult.rank,
      last_checked: rankResult.checkedAt,
    })
    .eq('id', shopId);

  if (updateError) {
    console.error(`[ERROR] 업체 업데이트 실패:`, updateError);
  }

  console.log(`[CRAWL] 완료: ${shop.shop_name} - 키워드: ${shop.keyword} - 순위: ${rankResult.rank || 'N/A'}`);

  return {
    success: true,
    shopId,
    shopName: shop.shop_name,
    keyword: shop.keyword,
    rank: rankResult.rank,
  };
}

// ============================================
// 전체 업체 크롤링
// ============================================
export async function crawlAllShops() {
  console.log('[CRAWL] ===== 전체 크롤링 시작 =====');
  const startTime = Date.now();

  // 활성화된 모든 업체 가져오기
  const { data: shops, error } = await supabase
    .from('place_shops')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('[ERROR] 업체 목록 조회 실패:', error);
    return { success: false, error: error.message };
  }

  console.log(`[CRAWL] 총 ${shops.length}개 업체 크롤링 예정`);

  const results = {
    total: shops.length,
    success: 0,
    failed: 0,
    details: [],
  };

  // 순차적으로 크롤링 (과도한 요청 방지)
  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i];
    
    try {
      const result = await crawlSingleShop(shop.id);
      
      if (result.success) {
        results.success++;
        results.details.push({
          shopName: shop.shop_name,
          rank: result.rank,
          status: 'success',
        });
      } else {
        results.failed++;
        results.details.push({
          shopName: shop.shop_name,
          status: 'failed',
          error: result.error,
        });
      }
    } catch (err) {
      results.failed++;
      results.details.push({
        shopName: shop.shop_name,
        status: 'error',
        error: err.message,
      });
    }

    // 요청 간격 (2~4초 랜덤)
    if (i < shops.length - 1) {
      const delay = 2000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 진행 상황 로그 (10개마다)
    if ((i + 1) % 10 === 0) {
      console.log(`[CRAWL] 진행: ${i + 1}/${shops.length}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[CRAWL] ===== 크롤링 완료 =====`);
  console.log(`[CRAWL] 총 ${results.total}개 중 성공: ${results.success}, 실패: ${results.failed}`);
  console.log(`[CRAWL] 소요 시간: ${elapsed}초`);

  return results;
}

// ============================================
// 새 업체 등록 시 정보 자동 수집
// ============================================
export async function initializeShopInfo(shopId) {
  const { data: shop, error } = await supabase
    .from('place_shops')
    .select('place_id')
    .eq('id', shopId)
    .single();

  if (error || !shop) {
    return { success: false, error: '업체를 찾을 수 없습니다.' };
  }

  const placeInfo = await fetchPlaceInfo(shop.place_id);
  
  if (placeInfo) {
    await supabase
      .from('place_shops')
      .update({
        shop_name: placeInfo.name,
        address: placeInfo.address,
        telephone: placeInfo.telephone,
        thumbnail: placeInfo.image,
        place_url: placeInfo.url,
        status: 'active',
      })
      .eq('id', shopId);

    return { success: true, info: placeInfo };
  }

  return { success: false, error: '플레이스 정보를 가져올 수 없습니다.' };
}
