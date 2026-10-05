// Lets this PC SSH into the server again after your internet IP changes. Run from the repo root:
//   node deploy/allow-my-ip.mjs
import { readFileSync } from 'node:fs';
import { EC2Client, AuthorizeSecurityGroupIngressCommand } from '@aws-sdk/client-ec2';

const info = JSON.parse(readFileSync(new URL('./aws-instance.json', import.meta.url)));
const myIp = (await (await fetch('https://checkip.amazonaws.com')).text()).trim();
const ec2 = new EC2Client({ region: info.region });
try {
  await ec2.send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: info.securityGroupId,
    IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: `${myIp}/32`, Description: 'SSH from owner PC' }] }],
  }));
  console.log(`✓ SSH allowed from ${myIp}`);
} catch (e) {
  if (e.name === 'InvalidPermission.Duplicate') console.log(`✓ SSH already allowed from ${myIp}`);
  else throw e;
}
