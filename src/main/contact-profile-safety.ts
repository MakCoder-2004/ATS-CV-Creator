import { BlockList, isIP } from 'node:net'

const blockedIpv4List = new BlockList()
const blockedIpv6List = new BlockList()
const blockedIpv4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]
const blockedIpv6: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64],
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]
for (const [network, prefix] of blockedIpv4) blockedIpv4List.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of blockedIpv6) blockedIpv6List.addSubnet(network, prefix, 'ipv6')

/** Reject non-global addresses from the URL literal or a one-time DNS safety check. */
export function isPublicContactProfileAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blockedIpv4List.check(address, 'ipv4')
  if (family === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !blockedIpv6List.check(address, 'ipv6')
  return false
}
export function arePublicContactProfileAddresses(addresses: string[]): boolean {
  return addresses.length > 0 && addresses.every(isPublicContactProfileAddress)
}
