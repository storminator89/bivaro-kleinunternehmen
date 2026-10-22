#!/bin/sh
# Only for a freshly built ephemeral container, with --network=none and no data mounts.
set -eu
[ "$(id -u)" != 0 ]
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ]
[ "$(node --version)" = v22.23.4 ]
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ghostscript)" ge '10.05.1~dfsg-1+deb13u3'
dpkg-query -W ghostscript openssl default-jre-headless util-linux util-linux-extra curl
node -e 'if (require("/app/node_modules/next/package.json").version !== "16.4.1") process.exit(1)'
java -version
echo '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9  /opt/bivaro/einvoice/validator-1.6.3-standalone.jar' | sha256sum -c -
timeout 30 java -jar /opt/bivaro/einvoice/validator-1.6.3-standalone.jar --help >/tmp/validator-help.txt
# Exercise real XML/XSD/Schematron on both accepted synthetic formats using
# the production JVM/resource-limit configuration, not just Java --help.
for format in cii ubl; do
  directory="/tmp/validation-$format"
  mkdir "$directory"
  cp "/tmp/validator-fixtures/valid-$format.xml" "$directory/source.xml"
  (
    cd "$directory"
    timeout 35 prlimit --as=2147483648:2147483648 --cpu=25:26 --nofile=64:64 --fsize=2097152:2097152 -- \
      java -Xms16m -Xmx192m -Xss512k -XX:+UseSerialGC -XX:ActiveProcessorCount=1 \
      -XX:MaxMetaspaceSize=64m -XX:CompressedClassSpaceSize=32m -XX:ReservedCodeCacheSize=32m \
      -XX:MaxDirectMemorySize=16m -XX:-CreateCoredumpOnCrash -Djava.awt.headless=true \
      -Djavax.xml.accessExternalDTD= -Djavax.xml.accessExternalSchema=file -Djavax.xml.accessExternalStylesheet=file \
      -jar /opt/bivaro/einvoice/validator-1.6.3-standalone.jar \
      -s "/opt/bivaro/einvoice/scenarios-$format.xml" -r /opt/bivaro/einvoice/rules \
      -o "$directory" "$directory/source.xml" >engine.log 2>&1
  )
  node - "$directory" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const sax = require('/tmp/smoke-sax');
const dir = process.argv[2];
const xml = fs.readFileSync(`${dir}/source-report.xml`, 'utf8');
if (!xml.length || Buffer.byteLength(xml)>2*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Invalid report');
const parser = sax.parser(true, {xmlns:true});
const ns='http://www.xoev.de/de/validator/varl/1';
const steps=new Map(); let depth=0, root=false, inHash=false, hash='';
parser.onopentag=n=>{depth++;if(depth===1){root=n.uri===ns&&n.local==='report'&&n.attributes.valid?.value==='true';}
 if(n.uri===ns&&n.local==='validationStepResult')steps.set(n.attributes.id?.value,n.attributes.valid?.value==='true');
 if(n.uri===ns&&n.local==='hashValue')inHash=true;};
parser.ontext=t=>{if(inHash)hash+=t;};parser.onclosetag=()=>{inHash=false;depth--;};
parser.write(xml).close();
if(!root||['val-xml','val-xsd','val-sch.1','val-sch.2'].some(k=>steps.get(k)!==true))throw Error('Validation did not pass');
if(hash.trim()!==crypto.createHash('sha256').update(fs.readFileSync(`${dir}/source.xml`)).digest('base64'))throw Error('Wrong report source');
NODE
 done
# Genuine PDF.js positive and negative receipt cases use the exact production
# parent wrapper, Landlock/seccomp, native canvas and per-request cleanup. An
# unsupported kernel/confinement fails this gate; there is no privileged retry.
timeout 150 node /app/scripts/ai-pdf/native-smoke.mjs
# Benign synthetic PS -> PDF -> PNG exercises the actual installed renderer.
printf '%%!PS\n/Helvetica findfont 12 scalefont setfont 30 50 moveto (Bivaro synthetic runtime check) show showpage\n' >/tmp/smoke.ps
timeout 30 gs -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile=/tmp/smoke.pdf /tmp/smoke.ps
timeout 30 gs -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r36 -sOutputFile=/tmp/smoke.png /tmp/smoke.pdf
test -s /tmp/smoke.pdf && test -s /tmp/smoke.png
# Each run has only an ephemeral /tmp database. Host mounts contain read-only
# test code/dependencies/fixtures only, never application data or host secrets.
export DATABASE_URL=file:/tmp/bivaro-container-smoke.db CHECKPOINT_DISABLE=1
node /app/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma
node /app/node_modules/prisma/build/index.js migrate diff --from-url="$DATABASE_URL" --to-schema-datamodel=/app/prisma/schema.prisma --exit-code
export NEXTAUTH_SECRET=synthetic-container-check-not-a-real-secret NEXTAUTH_URL=http://127.0.0.1:3000 HOSTNAME=127.0.0.1 PORT=3000
export BIVARO_SETUP_TOKEN=synthetic-container-smoke-bootstrap-117
DATABASE_MIGRATION_MODE=manual sh /app/docker-entrypoint.sh >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
ready=0
for attempt in $(seq 1 30); do
  if curl --silent --fail --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/api/health >/tmp/health.json; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then cat /tmp/server.log; exit 1; fi
node -e 'const h=require("/tmp/health.json"); if(h.checks.database.status!=="up")process.exit(1)'
node /tmp/own-invoice-container-smoke.mjs
echo 'Synthetic non-root container runtime checks passed.'
