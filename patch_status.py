import re
def load(p):
    with open(p, 'rb') as f: raw = f.read().decode('utf-8-sig')
    crlf = '\r\n' in raw
    return raw.replace('\r\n', '\n'), crlf
def save(p, s, crlf):
    if crlf: s = s.replace('\n', '\r\n')
    with open(p, 'wb') as f: f.write(s.encode('utf-8'))
def edit(label, s, old, new, count=1):
    if s.count(old) != count:
        print('SKIPPED', label, '(found %d, expected %d)' % (s.count(old), count)); return s
    print('OK     ', label); return s.replace(old, new)

p = 'src/modules/Dashboard/Sender/AccountScreen.tsx'
s, crlf = load(p)
s = edit('pending -> status page', s,
  "      Alert.alert('Awaiting Approval', 'Your provider application is pending admin review. You will be able to switch to Provider Mode once approved.', [{ text: 'OK' }]);\n",
  "      (navigation as any).navigate('ProviderApplicationStatus');\n")
s = edit('pending subtext', s, "'Waiting for admin approval'", "'Tap to track your application'")
s = edit('duplicate divider', s,
  "            <View style={styles.menuDivider} />\n\n            <View style={styles.menuDivider} />\n",
  "            <View style={styles.menuDivider} />\n")
save(p, s, crlf)

p = 'App.tsx'
s, crlf = load(p)
if 'ProviderApplicationStatusScreen' in s:
    print('SKIPPED App.tsx (already wired)')
else:
    m = re.search(r"^import RegisterProviderScreen[^\n]*\n", s, re.M)
    if m:
        s = s[:m.end()] + "import ProviderApplicationStatusScreen from './src/modules/Dashboard/Sender/ProviderApplicationStatusScreen';\n" + s[m.end():]
        print('OK      import')
    else: print('SKIPPED import (RegisterProviderScreen import not found)')
    m = re.search(r"^([ \t]*)<Stack\.Screen name=\"RegisterProvider\"[^\n]*\n", s, re.M)
    if m:
        s = s[:m.end()] + m.group(1) + '<Stack.Screen name="ProviderApplicationStatus" component={ProviderApplicationStatusScreen} />\n' + s[m.end():]
        print('OK      Stack.Screen')
    else: print('SKIPPED Stack.Screen (single-line RegisterProvider route not found)')
    m = re.search(r"^([ \t]*)RegisterProvider:[^\n]*\n", s, re.M)
    if m:
        s = s[:m.end()] + m.group(1) + 'ProviderApplicationStatus: undefined;\n' + s[m.end():]
        print('OK      param type')
    else: print('SKIPPED param type (not found)')
    save(p, s, crlf)
