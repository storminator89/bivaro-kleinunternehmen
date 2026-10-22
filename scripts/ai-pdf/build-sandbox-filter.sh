#!/bin/sh
# Build a native-architecture seccomp filter using the maintained util-linux tool.
# This only compiles policy bytes; it does not execute PDF or probe syscalls.
set -eu
out=${1:?usage: build-sandbox-filter.sh OUTPUT}
arch=$(uname -m)
case "$arch" in x86_64|aarch64) ;; *) echo 'Unsupported AI renderer architecture' >&2; exit 1 ;; esac
known=$(enosys --list)
set --
# No socket/IPC entry point or io_uring alternative. No cross-process handles,
# namespace/process-group escape, kernel loading, or metadata writes outside the
# Landlock path rules. clone remains for Node/Skia threads; group escape is denied.
for name in socket socketpair connect bind listen accept accept4 sendto sendmsg sendmmsg recvfrom recvmsg recvmmsg shutdown \
  io_uring_setup io_uring_enter io_uring_register \
  ptrace process_vm_readv process_vm_writev pidfd_open pidfd_getfd pidfd_send_signal \
  fork vfork setsid setpgid unshare setns mount umount2 pivot_root chroot open_by_handle_at name_to_handle_at \
  fsopen fsconfig fsmount fspick move_mount open_tree mount_setattr \
  bpf perf_event_open userfaultfd memfd_create memfd_secret \
  init_module finit_module delete_module kexec_load kexec_file_load reboot \
  chmod fchmod fchmodat fchmodat2 chown fchown lchown fchownat \
  setxattr lsetxattr fsetxattr removexattr lremovexattr fremovexattr setxattrat removexattrat file_setattr \
  utime utimes futimesat utimensat \
  truncate ftruncate ioctl keyctl add_key request_key \
  mq_open mq_unlink mq_timedsend mq_timedreceive mq_notify mq_getsetattr \
  shmget shmat shmdt shmctl semget semop semctl semtimedop msgget msgsnd msgrcv msgctl \
  kill tkill tgkill rt_sigqueueinfo rt_tgsigqueueinfo; do
  # The policy-data stage separately denies EVERY number not in this exact
  # architecture syscall inventory, including newer host-kernel calls. All
  # denylisted entries present in this build must successfully compile.
  if printf '%s\n' "$known" | awk -v n="$name" '$2 == n { found=1 } END { exit !found }'; then
    set -- "$@" -s "$name:EPERM"
  fi
done
# enosys supplies architecture validation and the portable syscall denylist.
# Add a small documented cBPF policy for clone flags and the entire x32 ABI,
# which enosys cannot express through syscall names alone.
base="${out}.base"
trap 'rm -f "$base"' EXIT HUP INT TERM
enosys "$@" --dump="$base"
node "$(dirname "$0")/complete-sandbox-filter.mjs" "$base" "$out" "$arch" "$known"
chmod 0444 "$out"
