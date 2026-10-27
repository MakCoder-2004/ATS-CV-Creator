import { expect, test } from 'vitest'
import { arePublicContactProfileAddresses, isPublicContactProfileAddress } from '../../src/main/contact-profile-safety'

test('contact profile address checks reject local, private, reserved and mixed DNS answers', () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '::', '::1', '::ffff:192.168.1.1', '64:ff9b::a00:1', '2001:db8::1', 'fc00::1', 'fe80::1', 'ff02::1']) {
    expect(isPublicContactProfileAddress(address), `${address} must not be treated as public`).toBe(false)
  }
  expect(isPublicContactProfileAddress('8.8.8.8')).toBe(true)
  expect(isPublicContactProfileAddress('2606:4700:4700::1111')).toBe(true)
  expect(arePublicContactProfileAddresses(['8.8.8.8', '1.1.1.1'])).toBe(true)
  expect(arePublicContactProfileAddresses([])).toBe(false)
  expect(arePublicContactProfileAddresses(['8.8.8.8', '127.0.0.1'])).toBe(false)
})
