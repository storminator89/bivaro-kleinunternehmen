import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
/** Foreign PDFs are not trusted generator output. The JVM gets a separate
 * read-only kernel sandbox; Node permissions do not protect a Java process.
 * No /proc, application tree, uploads, database, home, network or write grant.
 * Missing kernel/setpriv/filter support MUST fail; no shell/unconfined retry.
 */
export async function foreignVerifierCommand(binary: string, directory: string): Promise<(args: string[]) => string[]> {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || !process.getuid || !process.geteuid || process.getuid() === 0 || process.geteuid() === 0)
    throw new Error('Verifier confinement unavailable');
  const launcher = await realpath(binary), distribution = path.dirname(launcher);
  const jar = path.join(distribution, 'bin', 'cli-1.30.3.jar');
  const jarInfo = await lstat(jar);
  if (!jarInfo.isFile() || jarInfo.isSymbolicLink())
    throw new Error('Missing official validator distribution');
  const java = await realpath('/usr/bin/java'), javaHome = path.dirname(path.dirname(java));
  const filter = await realpath(path.join(process.cwd(), 'scripts', 'foreign-pdf', `sandbox-${process.arch}.bpf`));
  const rules = ['--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all', '--pdeathsig=KILL', '--landlock-access', 'fs', '--seccomp-filter', filter];
  const allow = (access: string, file: string) => rules.push('--landlock-rule', `path-beneath:${access}:${file}`);
  for (const root of ['/usr/lib', '/lib', javaHome, distribution, directory])
    allow('read-file,read-dir', await realpath(root));
  // JDK distro configuration can be an /etc symlink outside javaHome. It is
  // system runtime configuration, not an application's configuration directory.
  allow('read-file,read-dir', await realpath(path.join(javaHome, 'conf')));
  for (const file of ['/etc/ld.so.cache', '/dev/urandom', '/dev/null'])
    allow('read-file', await realpath(file));
  allow('read-file,execute', java);
  allow('read-file,execute', await realpath(process.arch === 'x64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1'));
  const javaArgs = [
    '-Xms16m', '-Xmx192m', '-Xss512k', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1',
    '-XX:MaxMetaspaceSize=64m', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m',
    '-XX:MaxDirectMemorySize=16m', '-XX:-CreateCoredumpOnCrash', '-XX:-UsePerfData', '-XX:-UseContainerSupport', '-XX:+DisableAttachMechanism',
    '-Djava.awt.headless=true', '-Djava.io.tmpdir=.', '-Duser.home=.', '-Duser.name=bivaro',
    '-Djavax.xml.accessExternalDTD=', '-Djavax.xml.accessExternalSchema=', '-Djavax.xml.accessExternalStylesheet=',
    '-Dfile.encoding=UTF8', '-classpath', `${distribution}/etc:${distribution}/bin/*`,
    '-Dapp.name=VeraPDF validation CLI', `-Dapp.repo=${distribution}/bin`, `-Dapp.home=${distribution}`, `-Dbasedir=${distribution}`,
    '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED', 'org.verapdf.apps.GreenfieldCliWrapper',
  ];
  return args => ['/usr/bin/setpriv', ...rules, '--', java, ...javaArgs, ...args];
}
