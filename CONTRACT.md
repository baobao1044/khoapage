# CONTRACT — Module hiệu ứng cho trang "KHOA"

Đây là bản hợp đồng bắt buộc. Mọi module phải tuân thủ 100% để ghép được.

## 1. Quy tắc chung (BẮT BUỘC)

- File của bạn là file DUY NHẤT bạn được tạo/sửa. TUYỆT ĐỐI không sửa
  `index.html`, `css/*`, `js/*`, `CONTRACT.md`, hay file `fx/*.js` của người khác.
- Vanilla JavaScript thuần. KHÔNG import, KHÔNG CDN, KHÔNG thư viện ngoài,
  KHÔNG `fetch`, KHÔNG asset ngoài. Trang phải chạy được khi mở bằng `file://`.
- Bọc toàn bộ trong IIFE: `(function () { 'use strict'; ... })();`
- Encoding UTF-8, tiếng Việt có dấu đầy đủ trong comment.
- Không được dùng `alert`, `document.write`, `eval`.
- Không khai báo biến global nào ngoài nhánh `window.FX.<key>` của bạn.

## 2. Đăng ký module

Cuối file:

```js
window.FX = window.FX || {};
window.FX.<key> = api;   // <key> ghi ở phần đặc tả của bạn
```

`api` bắt buộc có:

```js
{
  init: function (opts) { /* ... */ },   // gọi 1 lần, an toàn khi gọi lại (idempotent)
  destroy: function () { /* dọn dẹp, huỷ rAF, gỡ listener */ }
}
```

`opts` là object, có thể `undefined`. Luôn viết `opts = opts || {};`.
Các key có thể có trong `opts`:
- `opts.reduced` (boolean) — chế độ giảm chuyển động.
- `opts.zIndex` (number) — z-index gợi ý cho lớp overlay của bạn.

`init` phải chạy được kể cả khi gọi trước `DOMContentLoaded` (tự hoãn nếu cần).

## 3. Dải z-index đã phân (KHÔNG được lấn dải người khác)

| Module        | z-index |
|---------------|---------|
| cosmos        | 0       |
| matrix        | 1       |
| scroll        | 40      |
| tilt / text   | không tạo overlay — chỉ thao tác DOM sẵn có |
| burst         | 9000    |
| audio         | 9400    |
| cursor        | 9800    |

Nội dung trang nằm ở z-index 10–30.

## 4. Overlay

Nếu tạo overlay (canvas / div), bắt buộc:

```js
el.style.position = 'fixed';
el.style.inset = '0';
el.style.pointerEvents = 'none';   /* trừ nút bấm thật của module audio */
el.style.zIndex = String(z);
el.setAttribute('aria-hidden', 'true');
```

Overlay KHÔNG được chặn click/scroll của người dùng.

## 5. Hiệu năng (BẮT BUỘC)

- Canvas phải scale theo `devicePixelRatio` (cap ở 2) và tự vẽ lại khi `resize`.
- Dùng đúng MỘT vòng `requestAnimationFrame` cho mỗi module.
- Tự dừng vòng lặp khi `document.hidden === true` (nghe `visibilitychange`),
  chạy lại khi hiện lại.
- Nếu `opts.reduced === true` (hoặc
  `matchMedia('(prefers-reduced-motion: reduce)').matches`): giảm mạnh — số hạt
  tối đa ~15% , không rung màn hình, không nhấp nháy nhanh. Vẫn phải hiển thị
  được cái gì đó tĩnh/nhẹ, không được để trắng trơn.
- Giới hạn số hạt theo diện tích màn hình; trên mobile (`innerWidth < 700`) giảm
  còn ~40%.
- Không rò rỉ listener: `destroy()` phải gỡ sạch.

## 6. Bảng màu (dùng đúng bộ này để cả trang đồng bộ)

```
--neon-cyan   #22d3ee
--neon-pink   #f472b6
--neon-violet #a78bfa
--neon-lime   #a3e635
--neon-amber  #fbbf24
--ink         #05030f   (nền đen tím)
```

Chủ đạo: cyan + hồng + tím. Amber/lime dùng làm điểm nhấn.

## 7. Kiểm thử trước khi trả kết quả

Chạy: `node --check fx/<file>.js` — phải PASS, không lỗi cú pháp.
Tự đọc lại file, đảm bảo có đủ `init` và `destroy`, và có dòng `window.FX.<key> =`.

## 8. Báo cáo trả về

Trả về đúng 3 dòng:
1. Đường dẫn file đã tạo
2. Tên `window.FX.<key>` đã đăng ký
3. Liệt kê các hiệu ứng đã làm, mỗi cái vài chữ
