# Phát hành Aegir

Release được tạo hoàn toàn từ GitHub Actions và được kích hoạt bởi tag SemVer có tiền tố `v`, ví dụ `v0.1.0`. Workflow không nhận secret cá nhân: nó dùng `GITHUB_TOKEN` do GitHub cấp để tạo GitHub Release và tải artifact lên repository này.

## Những gì được kiểm tra và xuất bản

- CI (`.github/workflows/ci.yml`) chạy trên pull request và `main`: `gofmt`, `go vet`, Go tests, frontend tests, TypeScript type-check và frontend build.
- Release workflow chạy lại `go vet` và Go tests, kiểm tra cấu hình GoReleaser, rồi dùng GoReleaser v2 để build cross-platform.
- Mỗi archive chứa `aegir`, `aegir-analyzer`, `README.md`, và `web/dist/` đã build. Các target là macOS, Linux và Windows trên `amd64`/`arm64`; checksum SHA-256 của tất cả archive nằm trong `checksums.txt`.
- `aegir version` (hoặc `aegir --version`) in đúng version của tag. Build local in `dev`.

## Quy trình release

1. Hoàn tất PR, đảm bảo CI xanh trên `main`.
2. Cập nhật tài liệu/changelog cần thiết và tạo annotated tag từ commit trên `main`:

   ```sh
   git checkout main
   git pull --ff-only
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

3. Theo dõi workflow **Release** trên GitHub. Khi hoàn tất, GitHub Release có archive và `checksums.txt` sẽ được tạo tự động. Tag dạng prerelease, chẳng hạn `v0.1.0-rc.1`, được GoReleaser đánh dấu prerelease.
4. Trước khi dùng archive, kiểm tra checksum, giải nén và chạy binary từ thư mục đã giải nén để đường dẫn mặc định `web/dist` được tìm thấy:

   ```sh
   shasum -a 256 -c checksums.txt
   tar -xzf aegir_0.1.0_linux_amd64.tar.gz
   cd aegir_0.1.0_linux_amd64
   ./aegir serve
   ```

Có thể chạy lại release cho một tag đã tồn tại bằng **Actions → Release → Run workflow**, nhập chính xác tên tag. Điều này hữu ích khi workflow lỗi trước khi GitHub Release được tạo; không dùng để thay đổi artifact của một release đã công bố.

## Kiểm tra release trên máy local

Cài [GoReleaser v2](https://goreleaser.com/install/) rồi chạy:

```sh
make lint test
make release-snapshot
```

Snapshot nằm ở `dist/`, không tạo Git tag hay GitHub Release. GoReleaser tự chạy `npm ci` và build frontend theo hooks trong `.goreleaser.yaml`; vì vậy không release từ worktree có thay đổi chưa commit.
