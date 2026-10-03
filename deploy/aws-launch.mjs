// Creates the AWS infrastructure for MailPilot using the AWS credentials already saved on this PC
// (the default profile in ~/.aws, or AWS_PROFILE). Safe to re-run: existing resources are reused.
//
//   node deploy/aws-launch.mjs                 # region from your AWS config, else ap-south-1 (Mumbai)
//   node deploy/aws-launch.mjs --region us-east-1
//
// Creates: SSH key pair "mailpilot-key" (saved to ~/.ssh/mailpilot-key.pem), security group
// "mailpilot-sg" (SSH from your IP only; HTTP/HTTPS from anywhere), an Ubuntu 24.04 t3.small
// with a 20 GB disk, and an Elastic IP so the address never changes.
import {
  EC2Client, DescribeKeyPairsCommand, CreateKeyPairCommand, DescribeVpcsCommand, DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, DescribeImagesCommand, DescribeInstancesCommand,
  RunInstancesCommand, DescribeAddressesCommand, AllocateAddressCommand, AssociateAddressCommand, waitUntilInstanceRunning,
} from '@aws-sdk/client-ec2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argRegion = process.argv.includes('--region') ? process.argv[process.argv.indexOf('--region') + 1] : undefined;
const NAME = 'mailpilot';
const KEY_NAME = 'mailpilot-key';
const KEY_PATH = path.join(os.homedir(), '.ssh', `${KEY_NAME}.pem`);
const tag = (extra = []) => [{ Key: 'Name', Value: NAME }, { Key: 'app', Value: NAME }, ...extra];

let ec2 = new EC2Client(argRegion ? { region: argRegion } : {});
try { await ec2.config.region(); } catch { ec2 = new EC2Client({ region: 'ap-south-1' }); }
const region = await ec2.config.region();
console.log(`Region: ${region}`);

// 1. SSH key pair
const keys = await ec2.send(new DescribeKeyPairsCommand({ Filters: [{ Name: 'key-name', Values: [KEY_NAME] }] }));
if (!keys.KeyPairs.length) {
  const k = await ec2.send(new CreateKeyPairCommand({ KeyName: KEY_NAME, KeyType: 'rsa', KeyFormat: 'pem', TagSpecifications: [{ ResourceType: 'key-pair', Tags: tag() }] }));
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, k.KeyMaterial, { mode: 0o600 });
  console.log(`✓ Key pair created → ${KEY_PATH}`);
} else if (!fs.existsSync(KEY_PATH)) {
  throw new Error(`Key pair "${KEY_NAME}" exists in AWS but ${KEY_PATH} is missing. Delete the key pair in the EC2 console and re-run.`);
} else {
  console.log(`✓ Key pair exists (${KEY_PATH})`);
}

// 2. Security group in the default VPC
const vpc = (await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }))).Vpcs[0];
if (!vpc) throw new Error('No default VPC in this region.');
const myIp = (await (await fetch('https://checkip.amazonaws.com')).text()).trim();
let sg = (await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: 'group-name', Values: [`${NAME}-sg`] }, { Name: 'vpc-id', Values: [vpc.VpcId] }] }))).SecurityGroups[0];
if (!sg) {
  const { GroupId } = await ec2.send(new CreateSecurityGroupCommand({
    GroupName: `${NAME}-sg`, Description: 'MailPilot: SSH from owner, web from anywhere', VpcId: vpc.VpcId,
    TagSpecifications: [{ ResourceType: 'security-group', Tags: tag() }],
  }));
  sg = { GroupId };
  console.log(`✓ Security group created (${GroupId})`);
}
const rules = [
  { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: `${myIp}/32`, Description: 'SSH from owner PC' }] },
  { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
  { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
];
for (const r of rules) {
  try { await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: sg.GroupId, IpPermissions: [r] })); } catch (e) {
    if (e.name !== 'InvalidPermission.Duplicate') throw e;
  }
}
console.log(`✓ Firewall: SSH only from ${myIp}, HTTP/HTTPS open`);

// 3. Instance (reuse if one already exists)
let inst = (await ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: 'tag:Name', Values: [NAME] }, { Name: 'instance-state-name', Values: ['pending', 'running', 'stopped'] }] })))
  .Reservations.flatMap((r) => r.Instances)[0];
if (!inst) {
  const images = (await ec2.send(new DescribeImagesCommand({
    Owners: ['099720109477'], // Canonical
    Filters: [{ Name: 'name', Values: ['ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*'] }, { Name: 'state', Values: ['available'] }],
  }))).Images.sort((a, b) => b.CreationDate.localeCompare(a.CreationDate));
  if (!images.length) throw new Error('Ubuntu 24.04 image not found in this region.');
  inst = (await ec2.send(new RunInstancesCommand({
    ImageId: images[0].ImageId, InstanceType: 't3.small', KeyName: KEY_NAME, MinCount: 1, MaxCount: 1,
    SecurityGroupIds: [sg.GroupId],
    BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 20, VolumeType: 'gp3', DeleteOnTermination: true } }],
    MetadataOptions: { HttpTokens: 'required' },
    TagSpecifications: [{ ResourceType: 'instance', Tags: tag() }, { ResourceType: 'volume', Tags: tag() }],
  }))).Instances[0];
  console.log(`✓ Instance launching (${inst.InstanceId}, ${images[0].Name.split('/').pop()})`);
} else {
  console.log(`✓ Instance exists (${inst.InstanceId}, ${inst.State.Name})`);
}
await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [inst.InstanceId] });
console.log('✓ Instance running');

// 4. Elastic IP (fixed address: tracking links in sent emails must keep working)
let addr = (await ec2.send(new DescribeAddressesCommand({ Filters: [{ Name: 'tag:Name', Values: [NAME] }] }))).Addresses[0];
if (!addr) {
  const a = await ec2.send(new AllocateAddressCommand({ Domain: 'vpc', TagSpecifications: [{ ResourceType: 'elastic-ip', Tags: tag() }] }));
  addr = { AllocationId: a.AllocationId, PublicIp: a.PublicIp };
  console.log('✓ Elastic IP allocated');
}
if (addr.InstanceId !== inst.InstanceId) {
  await ec2.send(new AssociateAddressCommand({ AllocationId: addr.AllocationId, InstanceId: inst.InstanceId }));
}

const info = { region, instanceId: inst.InstanceId, securityGroupId: sg.GroupId, allocationId: addr.AllocationId, ip: addr.PublicIp, keyPath: KEY_PATH };
fs.writeFileSync(path.join(here, 'aws-instance.json'), JSON.stringify(info, null, 2));
console.log(`\n✓ READY  IP: ${addr.PublicIp}   key: ${KEY_PATH}`);
console.log('Details saved to deploy/aws-instance.json');
