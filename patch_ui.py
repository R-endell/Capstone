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

p = 'src/modules/Dashboard/Sender/RegisterProviderScreen.tsx'
s, crlf = load(p)
s = edit('status bar', s,
  '<StatusBar barStyle="light-content" backgroundColor={colors.accent} />',
  '<StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />')
s = edit('header markup', s,
"""      <Animated.View style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>Become a partner</Text>
          <Text style={styles.headerTitle}>Register as Provider</Text>
        </View>
      </Animated.View>
""",
"""      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 10 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Register as Provider</Text>
        <View style={{ width: 42 }} />
      </Animated.View>
""")
s = edit('header styles', s,
"""  header: {
    backgroundColor: c.accent,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 26, gap: 12,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.8)', fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.2 },
""",
"""  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
""")
s = edit('scroll padding', s, "scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },",
  "scrollContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 60 },")
s = edit('intro card radius', s,
  "backgroundColor: c.card, borderRadius: 12, padding: 16, gap: 12, marginBottom: 20,",
  "backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 12, marginBottom: 16,")
s = edit('progress as card', s,
"""    marginBottom: 26, paddingHorizontal: 10,
  },""",
"""    marginBottom: 16, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6,
    backgroundColor: c.card, borderRadius: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },""")
s = edit('upload section card', s,
  "  uploadSection: { marginBottom: 20 },",
"""  uploadSection: {
    marginBottom: 16, backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },""")
s = edit('details section card', s,
  "  detailsSection: { marginBottom: 20 },",
"""  detailsSection: {
    marginBottom: 16, backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },""")
s = edit('card header spacing', s,
  "flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,\n  },\n  uploadTitleRow",
  "flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,\n  },\n  uploadTitleRow")
s = edit('tile radius', s, "flex: 1, height: 140, borderRadius: 12,", "flex: 1, height: 140, borderRadius: 14,")
s = edit('text input bg', s,
  "backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,\n    paddingHorizontal: 14, paddingVertical: 12,",
  "backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 14,\n    paddingHorizontal: 14, paddingVertical: 12,")
s = edit('date button bg', s,
  "backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,\n    paddingHorizontal: 14, paddingVertical: 14,",
  "backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 14,\n    paddingHorizontal: 14, paddingVertical: 14,")
s = edit('progress dot ring', s, "borderWidth: 2, borderColor: c.card,\n  },\n  progressDotDone", "borderWidth: 0,\n  },\n  progressDotDone")
save(p, s, crlf)

p = 'src/modules/Dashboard/Sender/ProviderApplicationStatusScreen.tsx'
s, crlf = load(p)
if 'STATUS_ICONS' in s:
    print('SKIPPED status icon (already added)')
else:
    s = edit('import Image', s, "ActivityIndicator, Animated, Easing, RefreshControl, BackHandler,",
      "ActivityIndicator, Animated, Easing, RefreshControl, BackHandler, Image, ImageSourcePropType,")
    s = edit('icon slots', s, "const normalize = (",
"""// ---- STATUS ARTWORK PLACEHOLDERS ------------------------------------------
// Put your own icons in the project, then replace `null` with a require(), e.g.
//   pending: require('../../../../assets/status/pending.png'),
// While a slot is null, a built-in icon is shown instead. Suggested size: 128x128 PNG.
const STATUS_ICONS: Record<AppStatus, ImageSourcePropType | null> = {
  pending: null,
  approved: null,
  rejected: null,
};

const normalize = (""")
    s = edit('icon markup', s,
"""          <View style={styles.summary}>
            <View style={[styles.pill,""",
"""          <View style={styles.summary}>
            <View style={[styles.statusIconBox, { backgroundColor: pill.bg }]}>
              {STATUS_ICONS[status] ? (
                <Image source={STATUS_ICONS[status] as ImageSourcePropType} style={styles.statusIconImg} resizeMode="contain" />
              ) : (
                <SolarIcon
                  name={status === 'approved' ? 'CheckCircle' : status === 'rejected' ? 'CloseCircle' : 'Clock'}
                  variant="duotone" size={44} color={pill.fg}
                />
              )}
            </View>
            <View style={[styles.pill,""")
    s = edit('summary centered', s,
      "backgroundColor: c.card, borderRadius: 16, padding: 20, marginBottom: 24,\n",
      "backgroundColor: c.card, borderRadius: 16, padding: 20, marginBottom: 24, alignItems: 'center',\n")
    s = edit('pill centered', s, "pill: { alignSelf: 'flex-start',", "pill: { alignSelf: 'center',")
    s = edit('title centered', s, "summaryTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },",
      "summaryTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2, textAlign: 'center' },")
    s = edit('text centered', s, "lineHeight: 21, marginTop: 6 },\n\n  sectionLabel", "lineHeight: 21, marginTop: 6, textAlign: 'center' },\n\n  sectionLabel")
    s = edit('icon styles', s, "  pill: { alignSelf",
"""  statusIconBox: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  statusIconImg: { width: 56, height: 56 },
  pill: { alignSelf""")
    save(p, s, crlf)
