# RACAN 플레이스 순위 크롤러

네이버 플레이스 순위를 자동으로 추적하는 크롤러입니다.

## 🚀 Railway 배포 가이드

### 1. GitHub 저장소 준비

```bash
# crawler 폴더를 새 저장소로 만들거나 기존 저장소에 추가
git init
git add .
git commit -m "RACAN Place Crawler"
git remote add origin https://github.com/your-username/racan-place-crawler.git
git push -u origin main
```

### 2. Railway 프로젝트 생성

1. [Railway](https://railway.app) 로그인
2. **New Project** → **Deploy from GitHub repo**
3. 저장소 선택

### 3. 환경변수 설정

Railway Dashboard → Variables 에서 다음 환경변수 추가:

```
SUPABASE_URL=https://bxgrhdsxrlkpdnyaeyxc.supabase.co
SUPABASE_SERVICE_KEY=eyJ... (service_role 키)
PROXY_URL=http://spuqtp2czv:1voaShrNj_2f4V3hgB@kr.decodo.com:10001
CRAWL_HOUR=14
CRAWL_MINUTE=0
TIMEZONE=Asia/Seoul
```

### 4. 배포 확인

- 배포 완료 후 제공되는 URL로 접속
- `{ "status": "ok" }` 응답 확인

---

## 📡 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 서버 상태 확인 |
| GET | `/health` | 헬스체크 |
| GET | `/status` | 크롤링 상태 |
| POST | `/crawl/all` | 전체 크롤링 실행 |
| POST | `/crawl/shop/:shopId` | 단일 업체 크롤링 |
| POST | `/shop/init/:shopId` | 업체 정보 초기화 |
| GET | `/place/:placeId` | 플레이스 정보 조회 |

---

## ⏰ 스케줄

- **매일 오후 2시 (KST)** 자동 크롤링
- 환경변수로 시간 조정 가능

---

## 💰 월 비용

| 항목 | 비용 |
|------|------|
| Railway Hobby | $5 |
| Decodo 8GB | $24 |
| **합계** | **~$29** |

---

## 🔧 Decodo 프록시 정보

- **Host:** kr.decodo.com (한국 전용)
- **Ports:** 10001-19000
- **Username:** spuqtp2czv
- **Password:** 1voaShrNj_2f4V3hgB

포트를 로테이션하여 IP 차단 방지 (crawl.js에서 자동 처리)

---

## 📊 테스트

```bash
# 로컬 테스트
npm install
cp .env.example .env
# .env 파일 수정
npm start

# 수동 크롤링 테스트
curl -X POST http://localhost:3000/crawl/all
```
