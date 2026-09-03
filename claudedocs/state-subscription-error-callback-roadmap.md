# Roadmap: Realtime State Subscription için Hata Callback'i (@retter/sdk)

Tarih: 2026-09-03 · Mevcut sürüm: 0.16.0 · Hedef sürüm: 0.17.0 (minor, sadece ekleme)

**Durum (2026-09-03):** Faz 0–5 uygulandı, branch `feature/state-subscription-error-callback`. 83 test yeşil, d.ts diff yalnızca ekleme. Kalan: commit + `npm publish` 0.17.0 (Faz 6).

## 1. Mevcut durum (tespit)

Kaynak: `src/index.ts`, `src/types.ts`

| Nokta | Bugün ne oluyor | Sonuç |
|---|---|---|
| `getFirebaseListener` (`src/index.ts:295`) | `onSnapshot(document, onNext)` — **onError verilmiyor** | Firestore hatası (permission-denied, unauthenticated, unavailable, resource-exhausted…) sessizce yutulur; Firestore listener'ı iptal eder, bir daha event gelmez |
| `getFirebaseState` → `subscribe(observer)` (`src/index.ts:307-360`) | Sadece `queues.<scope>.subscribe(observer)`; `queue.error()` hiç çağrılmıyor | Client `{ next, error }` versin bile `error` asla tetiklenmez |
| `this.listeners[key]` | Hata sonrası key silinmiyor | Ölü listener "var" sayılır; `signOut` olmadan yeniden bağlanma imkânsız |
| `RetterCloudObjectStateObservable.subscribe` tipi (`src/types.ts:199`) | `(state?: any) => Subscription` | Gevşek tip; observer objesi geçmek derleniyor ama hata gelmiyor |
| `initFirebase` → `signInWithCustomToken` hatası | `getActionWithTokenData` içinde yakalanıp `signOut()` | Client'a nedeni iletilmez (bu roadmap'in dışında, not olarak) |

Firestore SDK'sı hata halinde `onError` çağırır ve listener'ı kapatır (`@firebase/firestore` `onSnapshot(ref, onNext, onError?)`). Yani hata **terminal** bir olaydır; client'ın haberdar olup yeniden subscribe olması gerekir.

Mevcut tüketiciler (fonksiyon-only subscribe, bozulmamalı):
- `rio-kubernetes-console/ui/src/providers/auth.tsx:88` — `state?.public.subscribe((event) => …)`
- `rio-kubernetes-console/ui/src/providers/project.tsx:34` — `state?.public.subscribe(async (event) => …)`
- `rio-cli` (`@retter/sdk@0.16.0`) — deploy bekleme akışında state stream
- `rio-admin-console` — `instance.state.public.subscribe(...)`

## 2. Tasarım kararı: neden `queue.error()` **kullanılmayacak**

RxJS'te `subject.error(e)` terminaldir ve **error handler vermeyen mevcut aboneler için** RxJS 7 hatayı `reportUnhandledError` ile asenkron olarak fırlatır (uncaught exception, `window.onerror`). Bugün sessizlik alan mevcut client'lar bir anda uncaught error almaya başlar → **kırıcı değişiklik**. Bu yüzden:

- Veri `ReplaySubject`'leri **hiç error'lamaz** (bugünkü davranış aynen korunur).
- Her scope için ayrı bir `Subject<RetterStateError>` hata kanalı açılır.
- Client `error` verirse ona bağlanır; vermezse bugünkü gibi sessiz kalır.
- Hata sonrası `this.listeners[key]` silinir → client aynı `subscribe()` çağrısıyla yeniden bağlanabilir (self-heal, otomatik retry değil).

## 3. Hedef API (geriye uyumlu)

```ts
// Mevcut kullanım — değişmez
cloudObject.state.public.subscribe((state) => { … })

// Yeni 1: Android SDK ile aynı şekil (eventFired, errorFired)
cloudObject.state.public.subscribe(
    (state) => { … },
    (err: RetterStateError) => { … }
)

// Yeni 2: RxJS observer objesi
cloudObject.state.user.subscribe({
    next: (state) => { … },
    error: (err: RetterStateError) => { … },
})

// Yeni 3 (opsiyonel, Faz 3): instance seviyesinde tek kanal, authStatus ile aynı desen
rio.stateErrors.subscribe((err: RetterStateError) => { … })
```

```ts
export type RetterStateScope = 'public' | 'user' | 'role'

export interface RetterStateError {
    scope: RetterStateScope
    classId: string
    instanceId: string
    /** Firestore hata kodu: 'permission-denied' | 'unauthenticated' | 'unavailable' | … */
    code: string
    message: string
    /** Orijinal FirestoreError */
    original: unknown
}

interface RetterCloudObjectStateObservable {
    queue?: ReplaySubject<any>
    subscribe: (
        observerOrNext?: ((state: any) => void) | Partial<Observer<any>>,
        error?: (err: RetterStateError) => void
    ) => Subscription
}
```

Mevcut tip `(state?: any) => Subscription` idi; ikinci parametre opsiyonel eklendiği ve ilk parametre genişletildiği için kaynak uyumluluğu bozulmaz.

## 4. Fazlar

### Faz 0 — Taban çizgisi (yarım gün)
- `npm test` ve `npm run build` yeşil olduğunu doğrula.
- `dist/index.d.ts` + `dist/types.d.ts` kopyasını al; iş sonunda diff'in **sadece ekleme** olduğunu kanıtlamak için.
- `git checkout -b feature/state-subscription-error-callback`.

### Faz 1 — Tipler (`src/types.ts`)
- `RetterStateScope`, `RetterStateError` ekle ve export et.
- `RetterCloudObjectStateObservable.subscribe` imzasını yukarıdaki gibi genişlet (`Observer` importu rxjs'ten).
- `RetterCloudObjectStates` / `RetterCloudObjectStateObservable` bugün `export` değil; d.ts emit'ini bozmamak için **mevcut export durumuna dokunma**.

### Faz 2 — Çekirdek (`src/index.ts`)
1. **Test dikişi**: Firestore çağrısını tek protected metoda topla:
   ```ts
   protected createStateListener(collection, documentId, onNext, onError): Unsubscribe {
       return onSnapshot(doc(this.firestore!, collection, documentId), onNext, onError)
   }
   ```
   Testler bunu `(rio as any).createStateListener = fake` ile override eder; gerçek Firebase init'e gerek kalmaz.
2. `getFirebaseListener(queue, errors, meta, collection, documentId, listenerKey)`:
   - `onNext`: bugünkü `__` prefix temizliği + `queue.next(data)` **aynen**.
   - `onError(e)`: `RetterStateError` oluştur → `errors.next(err)` → `delete this.listeners[listenerKey]` → (Faz 3) `this.stateErrorSubject.next(err)`.
3. `getFirebaseState`: `queues` yanına `errors = { role: new Subject(), user: new Subject(), public: new Subject() }`.
   Her scope'un `subscribe(observerOrNext, error?)` sarmalayıcısı:
   ```ts
   const sub = queue.subscribe(observerOrNext as any)          // bugünkü davranış
   const onErr = typeof observerOrNext === 'object' ? observerOrNext?.error : error
   if (onErr) sub.add(errors[scope].subscribe(onErr))         // tek Subscription, tek unsubscribe
   return sub
   ```
   Listener kurma (`if (!this.listeners[key])`) mantığı değişmez.
4. `clearCloudObjects`: veri queue'ları complete edilirken hata Subject'lerini de complete et (`RetterCloudObjectItem`'a `errors` alanı ekle veya state objesinde `errorQueue?` olarak tut).
5. Senkron hatalar (`this.firestore` undefined iken `doc()` fırlatması) **bugünkü gibi throw etmeye devam eder**; callback'e yönlendirilmez (davranış değişikliği olmaması için).

### Faz 3 — Instance seviyesi kanal (opsiyonel, küçük)
- `private stateErrorSubject = new Subject<RetterStateError>()`
- `public get stateErrors(): Observable<RetterStateError>` — `authStatus` getter'ı ile aynı desen.
- Sadece ekleme; mevcut API'ye dokunmaz.

### Faz 4 — Testler (`test/Retter.test.ts` veya yeni `test/StateSubscription.test.ts`)
Mevcut test altyapısı (node:test + axios mock) korunur; Firestore `createStateListener` dikişi ile sahtelenir.
- Fonksiyon-only subscribe → hata olduğunda callback **çağrılmaz**, uncaught error **oluşmaz** (regresyon koruması).
- `(next, error)` formu → `error` `RetterStateError` alır; `scope/classId/instanceId/code` doğru.
- `{ next, error }` formu → aynı.
- Hata sonrası `listeners[key]` silinmiş; tekrar `subscribe()` yeni listener açıyor.
- Dönen `Subscription.unsubscribe()` hem veri hem hata aboneliğini kapatıyor.
- `signOut()` → hata Subject'leri complete, sızıntı yok.
- Mevcut `__` prefix temizleme testi (yoksa ekle) yeşil.

### Faz 5 — Dokümantasyon ve sürüm
- `README.MD` "State Subscription" bölümüne iki yeni kullanım şekli + `RetterStateError` tablosu.
- `docs/backend-api.md` §9: "Firestore listener hatası `error` callback'ine iletilir, listener kapanır, tekrar subscribe gerekir" cümlesi.
- `package.json` → `0.17.0`; `npm run build` (prebuild `version.ts` üretir, webpack `bundle/` günceller).
- `dist/*.d.ts` diff'i Faz 0 kopyasıyla karşılaştır: sadece ekleme olmalı.

### Faz 6 — Yayın ve tüketici takibi (ayrı iş)
- `npm publish` 0.17.0.
- Tüketicilerin yükseltmesi zorunlu değil; istenirse `rio-kubernetes-console` `auth.tsx:88` / `project.tsx:34` ve `rio-cli` deploy bekleme akışı `error` callback'i ekleyip kullanıcıya "realtime bağlantı koptu" gösterebilir.

## 5. Kapsam dışı (not edildi, dokunulmayacak)
- `processAuthQueue` içinde `initFirebase` fırlatırsa `switchMap` auth stream'ini kalıcı öldürür (mevcut gizli bug). Ayrı iş.
- Firestore hatası sonrası **otomatik** yeniden bağlanma / backoff. Bu roadmap sadece haber verir ve yeniden subscribe'a izin verir.
- `signInWithCustomToken` başarısızlığının client'a nedeniyle iletilmesi.
- `unsubscribers` dizisinin hiç budanmaması.

## 6. Kabul kriterleri
- Mevcut testler + yeni testler yeşil.
- `dist/*.d.ts` diff'i yalnızca yeni tip/alan ekliyor; mevcut hiçbir imza daralmıyor.
- Fonksiyon-only `subscribe` çağrısı için çalışma zamanı davranışı byte-byte aynı: aynı event'ler, hata halinde sessizlik.
- Android SDK ile aynı `(eventFired, errorFired)` şekli JS'te de çalışıyor.
