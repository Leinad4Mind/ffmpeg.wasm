#include <emscripten.h>
#include <emscripten/wasmfs.h>

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int opfs_mounted = 0;
static char opfs_mountpoint[256] = {0};

static int is_existing_dir(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISDIR(st.st_mode);
}

EMSCRIPTEN_KEEPALIVE
int ffwasm_mount_opfs(const char *mountpoint) {
  if (!mountpoint || !mountpoint[0]) {
    errno = EINVAL;
    return -EINVAL;
  }

  if (opfs_mounted) {
    if (strcmp(opfs_mountpoint, mountpoint) == 0) {
      return 0;
    }
    errno = EBUSY;
    return -EBUSY;
  }

  if (is_existing_dir(mountpoint)) {
    errno = EEXIST;
    return -EEXIST;
  }

  backend_t opfs = wasmfs_create_opfs_backend();
  int ret = wasmfs_create_directory(mountpoint, 0777, opfs);
  if (ret != 0) {
    return ret;
  }

  strncpy(opfs_mountpoint, mountpoint, sizeof(opfs_mountpoint) - 1);
  opfs_mountpoint[sizeof(opfs_mountpoint) - 1] = '\0';
  opfs_mounted = 1;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
int ffwasm_mkdirp(const char *path) {
  if (!path || !path[0]) {
    errno = EINVAL;
    return -EINVAL;
  }

  size_t len = strlen(path);
  if (len >= 1024) {
    errno = ENAMETOOLONG;
    return -ENAMETOOLONG;
  }

  char tmp[1024];
  memcpy(tmp, path, len + 1);

  for (char *p = tmp + 1; *p; ++p) {
    if (*p != '/') {
      continue;
    }
    *p = '\0';
    if (!is_existing_dir(tmp) && mkdir(tmp, 0777) != 0 && errno != EEXIST) {
      int err = errno;
      *p = '/';
      return -err;
    }
    *p = '/';
  }

  if (!is_existing_dir(tmp) && mkdir(tmp, 0777) != 0 && errno != EEXIST) {
    return -errno;
  }

  return 0;
}

EMSCRIPTEN_KEEPALIVE
int ffwasm_write_file(const char *path, const unsigned char *data, size_t len) {
  if (!path || !path[0] || (!data && len > 0)) {
    errno = EINVAL;
    return -EINVAL;
  }

  FILE *file = fopen(path, "wb");
  if (!file) {
    return -errno;
  }

  size_t written = 0;
  while (written < len) {
    size_t n = fwrite(data + written, 1, len - written, file);
    if (n == 0) {
      int err = ferror(file) ? errno : EIO;
      fclose(file);
      return -err;
    }
    written += n;
  }

  if (fclose(file) != 0) {
    return -errno;
  }

  return 0;
}

EMSCRIPTEN_KEEPALIVE
long long ffwasm_file_size(const char *path) {
  if (!path || !path[0]) {
    errno = EINVAL;
    return -EINVAL;
  }

  struct stat st;
  if (stat(path, &st) != 0) {
    return -errno;
  }

  return (long long)st.st_size;
}

EMSCRIPTEN_KEEPALIVE
int ffwasm_read_file_chunk(
  const char *path,
  long long offset,
  unsigned char *out,
  size_t len,
  size_t *bytes_read
) {
  if (!path || !path[0] || (!out && len > 0) || !bytes_read || offset < 0) {
    errno = EINVAL;
    return -EINVAL;
  }

  *bytes_read = 0;

  FILE *file = fopen(path, "rb");
  if (!file) {
    return -errno;
  }

  if (fseeko(file, (off_t)offset, SEEK_SET) != 0) {
    int err = errno;
    fclose(file);
    return -err;
  }

  if (len == 0) {
    if (fclose(file) != 0) {
      return -errno;
    }
    return 0;
  }

  size_t n = fread(out, 1, len, file);
  if (n < len && ferror(file)) {
    int err = errno;
    fclose(file);
    return -err;
  }

  *bytes_read = n;
  if (fclose(file) != 0) {
    return -errno;
  }

  return 0;
}
