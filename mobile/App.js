import { friendlyError } from './userFeedback.mjs'
import { householdInviteError, householdInviteSendError } from './householdInvites.mjs'
import { sortMissions, saveMissionOrder, missionRowOffset, MISSION_ROW_HEIGHT, MISSION_ROW_STEP } from './missionOrdering.mjs'
import { useMissionDrag } from './useMissionDrag'
import { softDeleteMission } from './missionDeletion.mjs'
import { missionIconOptions, missionIcon, missionVisualFields } from './missionIcons.mjs'
﻿import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, KeyboardAvoidingView, Linking, Modal, Platform, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as Crypto from 'expo-crypto'
import { configured, supabase } from './supabase'

const colors = ['#F6C343', '#76CFF5', '#AEEFD7', '#F6A98C', '#9FA8E8']
const starterRewards = [
  { name: 'Chocolate', starCost: 10 },
  { name: 'Going to the park', starCost: 20 },
  { name: 'Choose a toy', starCost: 30 },
  { name: 'Big reward', starCost: 50 },
]

function rewardPresentation(name) {
  const key = String(name || '').trim().toLowerCase()
  if (key === 'chocolate') return { emoji: '🍫', description: 'Pick a special chocolate treat' }
  if (key === 'going to the park') return { emoji: '🌳', description: 'Time for a fun park trip' }
  if (key === 'choose a toy') return { emoji: '🧸', description: 'Pick a toy you love' }
  if (key === 'big reward') return { emoji: '🏆', description: 'Something extra special' }
  return { emoji: '🎁', description: 'A special reward to look forward to' }
}

function rewardDisplay(reward) {
  return { ...reward, stars: Number(reward.star_cost), ...rewardPresentation(reward.name) }
}

function normalizeRewardDraft(name, starCost) {
  const normalizedName = String(name || '').trim()
  const normalizedCost = Number(String(starCost || '').trim())
  if (!normalizedName || normalizedName.length > 80) throw new Error('Enter a reward name up to 80 characters.')
  if (!Number.isSafeInteger(normalizedCost) || normalizedCost < 1 || normalizedCost > 10000) throw new Error('Enter a whole number of stars from 1 to 10,000.')
  return { name: normalizedName, starCost: normalizedCost }
}
const shortActivityLabels = {
  'Pooped in Potty': 'Poop in potty',
  'Pee in Potty': 'Pee in potty',
  'Help with laundry': 'Laundry',
  'Help with dishes': 'Dishes',
}
const cooldownPresets = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 43200]

function formatCooldown(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  return `${seconds / 60} min`
}
const householdInviteTokenPattern = /^[A-Za-z0-9_-]{43}$/

function householdInviteFromUrl(url) {
  if (!url) return null
  const query = url.split('?')[1]?.split('#')[0] || ''
  const token = new URLSearchParams(query).get('invite')
  return token && householdInviteTokenPattern.test(token) ? token : null
}

function authTokensFromUrl(url) {
  const fragment = url?.split('#')[1] || ''
  const values = new URLSearchParams(fragment)
  const access_token = values.get('access_token')
  const refresh_token = values.get('refresh_token')
  return access_token && refresh_token ? { access_token, refresh_token } : null
}
const redemptionConfetti = Array.from({ length: 30 }, (_, index) => ({
  left: `${4 + ((index * 29) % 92)}%`,
  top: `${10 + ((index * 17) % 78)}%`,
  rotate: `${(index * 47) % 180}deg`,
  color: colors[index % colors.length],
}))

function unwrap(result) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function displayMissionName(mission) {
  return shortActivityLabels[mission.name] || mission.name
}

function LoadingScreen() {
  return <SafeAreaView style={styles.safe}><View style={styles.auth} accessible accessibilityLabel="Loading your stars" accessibilityLiveRegion="polite"><Text style={styles.logo}>{'\u2605'}</Text><ActivityIndicator size="large" color="#0E3A66" /><Text style={[styles.body, { textAlign: 'center' }]}>Getting your stars ready...</Text></View></SafeAreaView>
}

function Auth({ onSession }) {
  const [mode, setMode] = useState('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit() {
    if (!email.trim() || !password) { setMessage('Enter your email and password.'); return }
    setBusy(true); setMessage('')
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (result.error) { setMessage(friendlyError(result.error, 'Could not sign in. Check your details and try again.')); return }
    if (result.data.session) onSession(result.data.session)
    else setMessage('Check your email to confirm your account, then sign in.')
  }

  return <SafeAreaView style={styles.safe}><View style={styles.auth}><Text style={styles.logo}>★</Text><Text style={styles.eyebrow}>PARENT SIGN-IN</Text><Text style={styles.title}>Our Little Star</Text><Text style={styles.body}>Sign in to your shared family stars.</Text><View style={styles.tabs}><Pressable accessibilityRole="button" style={[styles.tab, mode === 'sign-in' && styles.tabActive]} onPress={() => setMode('sign-in')}><Text>Sign in</Text></Pressable><Pressable accessibilityRole="button" style={[styles.tab, mode === 'sign-up' && styles.tabActive]} onPress={() => setMode('sign-up')}><Text>Sign up</Text></Pressable></View><TextInput accessibilityLabel="Email" style={styles.input} placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} /><TextInput accessibilityLabel="Password" style={styles.input} placeholder="Password" secureTextEntry autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={password} onChangeText={setPassword} /><Pressable accessibilityRole="button" style={styles.primary} disabled={busy} onPress={submit}><Text style={styles.primaryText}>{busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</Text></Pressable>{message ? <Text style={styles.message}>{message}</Text> : null}</View></SafeAreaView>
}

function HouseholdInviteDecision({ decision, onConfirmEmptySwitch, onConnectFamilies, onCancel }) {
  const isEmptySwitch = decision?.outcome === 'confirm_empty_switch'
  const [manualMessage, setManualMessage] = useState('')
  return <SafeAreaView style={styles.safe}><View style={styles.auth}>
    <Text style={styles.title}>{isEmptySwitch ? `Join ${decision.householdName}?` : 'Both families have activity'}</Text>
    {isEmptySwitch
      ? <Text style={styles.body}>Your current family has no star history. Joining will keep it safely preserved, then connect this account to {decision.householdName}.</Text>
      : <Text style={styles.body}>We found activity in both family accounts. Nothing will be changed automatically.</Text>}
    {manualMessage ? <Text accessibilityLiveRegion="polite" style={styles.inviteSuccess}>{manualMessage}</Text> : null}
    {isEmptySwitch
      ? <Pressable accessibilityRole="button" style={styles.primary} onPress={onConfirmEmptySwitch}><Text style={styles.primaryText}>Join family</Text></Pressable>
      : <Pressable accessibilityRole="button" style={styles.primary} onPress={() => { setManualMessage('This connection needs a manual review before data can be combined. Nothing was changed.'); onConnectFamilies?.() }}><Text style={styles.primaryText}>Connect families</Text></Pressable>}
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onCancel}><Text>Cancel</Text></Pressable>
  </View></SafeAreaView>
}

const confettiPieces = Array.from({ length: 40 }, (_, index) => ({
  x: [0.12, 0.28, 0.44, 0.56, 0.72, 0.88][index % 6],
  y: [0.24, 0.36, 0.48][Math.floor(index / 6) % 3],
  endX: 0.04 + ((index * 37) % 92) / 100,
  endY: 0.42 + ((index * 17) % 56) / 100,
  turn: index % 2 ? 270 + index * 13 : -270 - index * 13,
  round: index % 4 === 0,
}))
const sparkleOffsets = [[-148, -128], [142, -124], [-176, -4], [172, 12], [-78, 142], [80, 140]]

function Celebration({ visible, balanceTarget, run, onFinish }) {
  const { width, height } = useWindowDimensions()
  const dim = useRef(new Animated.Value(0)).current
  const starScale = useRef(new Animated.Value(0.12)).current
  const starOpacity = useRef(new Animated.Value(1)).current
  const travelX = useRef(new Animated.Value(0)).current
  const travelY = useRef(new Animated.Value(0)).current
  const sparkles = useRef(sparkleOffsets.map(() => new Animated.Value(0))).current
  const confetti = useRef(confettiPieces.map(() => new Animated.Value(0))).current
  const startX = width / 2 - 200
  const startY = height / 2 - 220
  const toX = balanceTarget ? balanceTarget.x - 200 - startX : 0
  const toY = balanceTarget ? balanceTarget.y - 200 - startY : -height * 0.32

  useEffect(() => {
    if (!visible) return undefined
    ;[dim, starScale, starOpacity, travelX, travelY].forEach((value, index) => value.setValue(index === 1 ? 0.05 : index === 2 ? 1 : 0))
    sparkles.forEach((value) => value.setValue(0))
    confetti.forEach((value) => value.setValue(0))
    const confettiAnimation = Animated.parallel(confetti.map((value, index) => Animated.sequence([
      Animated.delay(index * 5),
      Animated.timing(value, { toValue: 1, duration: 1650, useNativeDriver: true }),
    ])))
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(dim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(starScale, { toValue: 1, tension: 175, friction: 3.5, useNativeDriver: true }),
        ...sparkles.map((value, index) => Animated.sequence([Animated.delay(70 + index * 34), Animated.spring(value, { toValue: 1, tension: 170, friction: 5, useNativeDriver: true })])),
      ]),
      // Keep the reward star center-stage after its initial pop.
      Animated.delay(400),
      Animated.parallel([
        Animated.timing(travelX, { toValue: toX, duration: 450, useNativeDriver: true }),
        Animated.timing(travelY, { toValue: toY, duration: 450, useNativeDriver: true }),
        Animated.timing(starScale, { toValue: 0.22, duration: 450, useNativeDriver: true }),
        Animated.timing(starOpacity, { toValue: 0.3, duration: 450, useNativeDriver: true }),
        Animated.timing(dim, { toValue: 0, duration: 380, useNativeDriver: true }),
      ]),
    ])
    confettiAnimation.start()
    animation.start(({ finished }) => { if (finished) onFinish() })
    return () => { animation.stop(); confettiAnimation.stop() }
  }, [visible, run])

  if (!visible) return null
  return <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.celebration}>
    <Animated.View style={[styles.celebrationDim, { opacity: dim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.34] }) }]} />
    {confetti.map((value, index) => { const piece = confettiPieces[index]; return <Animated.View key={index} style={[styles.confetti, piece.round && styles.confettiRound, { left: piece.x * width, top: piece.y * height, backgroundColor: colors[index % colors.length], opacity: value.interpolate({ inputRange: [0, 0.08, 0.8, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, (piece.endX - piece.x) * width] }) }, { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, (piece.endY - piece.y) * height] }) }, { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.turn}deg`] }) }] }]} /> })}
    {sparkles.map((value, index) => <Animated.Text key={index} style={[styles.sparkle, { left: width / 2 + sparkleOffsets[index][0], top: height / 2 - 48 + sparkleOffsets[index][1], color: colors[(index + 2) % colors.length], opacity: value, transform: [{ scale: value }] }]}>{'\u2726'}</Animated.Text>)}
    <Animated.View style={[styles.flyingStar, { left: startX, top: startY, opacity: starOpacity, transform: [{ translateX: travelX }, { translateY: travelY }, { scale: starScale }] }]}><Text style={styles.bigStar}>{'\u2605'}</Text></Animated.View>
    </View>
  </Modal>
}

function RedemptionSuccess({ reward, onHome, onRewards }) {
  const cardScale = useRef(new Animated.Value(0.82)).current

  useEffect(() => {
    cardScale.setValue(0.82)
    Animated.spring(cardScale, { toValue: 1, tension: 155, friction: 7, useNativeDriver: true }).start()
  }, [reward?.requestId])

  if (!reward) return null
  return <Modal visible transparent animationType="fade" statusBarTranslucent>
    <SafeAreaView style={styles.redemptionSuccess}>
      {redemptionConfetti.map((piece, index) => <View key={index} pointerEvents="none" style={[styles.redemptionConfetti, { left: piece.left, top: piece.top, backgroundColor: piece.color, transform: [{ rotate: piece.rotate }] }]} />)}
      <ScrollView contentContainerStyle={styles.redemptionSuccessContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.congratulations}>Congratulations!</Text>
        <Text style={styles.redeemedSubtitle}>You redeemed a reward!</Text>
        <Animated.View style={[styles.redeemedCard, { transform: [{ scale: cardScale }] }]}><Text style={styles.redeemedEmoji}>{reward.emoji}</Text><Text style={styles.redeemedName}>{reward.name}</Text><Text style={styles.redeemedPraise}>Great job earning {reward.stars} stars!</Text></Animated.View>
        <View style={styles.redeemedStars}><Text style={styles.redeemedStarsIcon}>{'\u2605'}</Text><Text style={styles.redeemedStarsText}>{reward.stars} stars redeemed</Text></View>
        <View style={styles.redeemedEncouragement}><Text style={styles.redeemedEncouragementText}>You’re awesome!</Text><Text style={styles.redeemedHeart}>{'♥'}</Text></View>
        <Pressable accessibilityRole="button" style={styles.backHomeButton} onPress={onHome}><Text style={styles.backHomeIcon}>⌂</Text><Text style={styles.backHomeText}>Back to Home</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.allRewardsButton} onPress={onRewards}><Text style={styles.allRewardsText}>View All Rewards</Text><Text style={styles.allRewardsChevron}>{'›'}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  </Modal>
}

function RewardsScreen({ visible, balance, rewards, onBack, onRedeem }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const availableHeight = height - insets.top - insets.bottom
  const compact = width < 360 || availableHeight < 720
  const tight = width < 340 || availableHeight < 620
  const activeRewards = (rewards || []).filter((reward) => !reward.archived_at).map(rewardDisplay)
  const needsScroll = activeRewards.length > 4
  const content = <>
    {activeRewards.map((reward) => {
      const unlocked = balance >= reward.stars
      const remaining = Math.max(reward.stars - balance, 0)
      return <View key={reward.id} style={[styles.rewardsScreenCard, compact && styles.rewardsScreenCardCompact, tight && styles.rewardsScreenCardTight, !unlocked && styles.rewardsScreenCardLocked]}>
        <View style={[styles.rewardsScreenCost, compact && styles.rewardsScreenCostCompact, tight && styles.rewardsScreenCostTight, unlocked && styles.rewardsScreenCostUnlocked]}><Text style={[styles.rewardsScreenCostNumber, tight && styles.rewardsScreenCostNumberTight]}>{reward.stars}</Text><Text style={styles.rewardsScreenCostLabel}>stars</Text></View>
        <Text style={[styles.rewardsScreenEmoji, compact && styles.rewardsScreenEmojiCompact, tight && styles.rewardsScreenEmojiTight]}>{reward.emoji}</Text>
        <View style={styles.rewardsScreenDetails}><Text numberOfLines={2} style={[styles.rewardsScreenRewardName, tight && styles.rewardsScreenRewardNameTight]}>{reward.name}</Text><Text numberOfLines={2} style={[styles.rewardsScreenDescription, tight && styles.rewardsScreenDescriptionTight]}>{reward.description}</Text>{unlocked ? <Pressable accessibilityRole="button" accessibilityLabel={`Redeem ${reward.name} for ${reward.stars} stars`} style={[styles.rewardsRedeemButton, tight && styles.rewardsRedeemButtonTight]} onPress={() => onRedeem(reward)}><Text style={styles.rewardsRedeemButtonText}>Redeem ({reward.stars} {'★'})</Text></Pressable> : <Text style={[styles.rewardsLockedText, tight && styles.rewardsLockedTextTight]}>Need {remaining} more {remaining === 1 ? 'star' : 'stars'}</Text>}</View>
      </View>
    })}
    {!activeRewards.length ? <View style={styles.rewardsEmpty}><Text style={styles.parentSectionTitle}>Rewards are coming soon</Text><Text style={styles.body}>A parent can add rewards in Parent Controls.</Text></View> : null}
    <View style={[styles.keepGoingCard, compact && styles.keepGoingCardCompact, tight && styles.keepGoingCardTight]}><Text style={[styles.keepGoingStar, tight && styles.keepGoingStarTight]}>{'★'}</Text><View><Text style={[styles.keepGoingTitle, tight && styles.keepGoingTitleTight]}>Keep going!</Text><Text style={[styles.keepGoingText, tight && styles.keepGoingTextTight]}>You’re doing great!</Text></View></View>
  </>

  return <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
    <SafeAreaView style={styles.rewardsScreen}>
      <View style={[styles.rewardsHeader, compact && styles.rewardsHeaderCompact, tight && styles.rewardsHeaderTight]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to home" style={[styles.rewardsBackButton, tight && styles.rewardsBackButtonTight]} onPress={onBack}><Text style={[styles.rewardsBackIcon, tight && styles.rewardsBackIconTight]}>{'‹'}</Text></Pressable>
        <View style={styles.rewardsHeading}><Text style={[styles.rewardsScreenTitle, tight && styles.rewardsScreenTitleTight]}>Rewards</Text><Text style={[styles.rewardsScreenSubtitle, tight && styles.rewardsScreenSubtitleTight]}>You earn stars by doing awesome things!</Text></View>
        <View accessible accessibilityLabel={`${balance} stars`} style={[styles.rewardsHeaderBalance, tight && styles.rewardsHeaderBalanceTight]}><Text style={[styles.rewardsHeaderBalanceStar, tight && styles.rewardsHeaderBalanceStarTight]}>{'★'}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={[styles.rewardsHeaderBalanceNumber, tight && styles.rewardsHeaderBalanceNumberTight]}>{balance}</Text><Text style={styles.rewardsHeaderBalanceLabel}>stars</Text></View>
      </View>
      {needsScroll ? <ScrollView contentContainerStyle={[styles.rewardsScrollContent, { paddingBottom: Math.max(insets.bottom, 12) }]}>{content}</ScrollView> : <View style={[styles.rewardsScreenContent, { paddingBottom: Math.max(insets.bottom, 12) }, compact && styles.rewardsScreenContentCompact, tight && styles.rewardsScreenContentTight]}>{content}</View>}
    </SafeAreaView>
  </Modal>
}

function DraggableBottomSheet({ visible, title, onDismiss, children, scrollRef, scrollEnabled = true, onScroll, onScrollLayout, onContentSizeChange }) {
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const sheetOffset = useRef(new Animated.Value(height)).current
  const dragOffset = useRef(new Animated.Value(0)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current
  const dismissing = useRef(false)
  const latestSheet = useRef(null)
  latestSheet.current = { height, onDismiss }

  function dismiss() {
    if (dismissing.current) return
    dismissing.current = true
    Animated.parallel([
      Animated.timing(dragOffset, { toValue: latestSheet.current.height, duration: 180, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      dismissing.current = false
      latestSheet.current.onDismiss()
    })
  }

  const panResponder = useRef(PanResponder.create({
    // This header contains no controls, so it can safely claim every touch that
    // begins here before the ScrollView has a chance to handle it.
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      dragOffset.stopAnimation()
    },
    onPanResponderMove: (_event, gesture) => {
      const distance = Math.max(0, gesture.dy)
      dragOffset.setValue(distance)
    },
    onPanResponderRelease: (_event, gesture) => {
      const distance = Math.max(0, gesture.dy)
      const reachedThreshold = distance > 120 || gesture.vy > 1.2
      if (reachedThreshold) {
        dismiss()
      } else {
        Animated.spring(dragOffset, { toValue: 0, tension: 170, friction: 18, useNativeDriver: true }).start()
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragOffset, { toValue: 0, tension: 170, friction: 18, useNativeDriver: true }).start()
    },
    onPanResponderTerminationRequest: () => false,
  })).current

  useEffect(() => {
    if (!visible) return
    sheetOffset.setValue(height); dragOffset.setValue(0); backdropOpacity.setValue(0)
    Animated.parallel([
      Animated.spring(sheetOffset, { toValue: 0, tension: 145, friction: 19, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start()
  }, [visible, height])

  return <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={dismiss}>
    <KeyboardAvoidingView style={styles.bottomSheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Animated.View pointerEvents="none" style={[styles.bottomSheetBackdrop, { opacity: backdropOpacity }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${title}`} style={styles.bottomSheetDismissArea} onPress={dismiss} />
      <Animated.View style={[styles.parentSheet, { transform: [{ translateY: Animated.add(sheetOffset, dragOffset) }] }]}>
        <View {...panResponder.panHandlers} style={styles.sheetDragZone}><View accessible={false} importantForAccessibility="no" style={styles.sheetHandle} /><Text style={styles.sheetTitle}>{title}</Text></View>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" ref={scrollRef} scrollEnabled={scrollEnabled} onScroll={onScroll} scrollEventThrottle={16} onLayout={onScrollLayout} onContentSizeChange={onContentSizeChange} style={styles.parentSheetScroll} contentContainerStyle={[styles.parentSheetContent, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>
}

function InviteParentSheet({ visible, familyId, onDismiss }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function sendInvite() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Enter a valid email address.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error: functionError } = await supabase.functions.invoke('send-household-invite', { body: { familyId, email: normalizedEmail } })
      if (functionError) throw functionError
      if (!data?.sent) { setError(householdInviteSendError(data?.errorCode)); return }
      setMessage('Invite sent. Waiting for them to join.')
      setEmail('')
    } catch (problem) { setError(householdInviteError(problem, 'The invitation could not be sent. Please try again.')) } finally { setBusy(false) }
  }

  return <DraggableBottomSheet visible={visible} title="Invite another parent" onDismiss={onDismiss}>
    <Text style={styles.body}>Enter their email and we’ll send a private invitation.</Text>
    <TextInput accessibilityLabel="Parent email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="parent@example.com" value={email} onChangeText={setEmail} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.inviteSuccess}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.missionBusy]} onPress={sendInvite}><Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send invite'}</Text></Pressable>
  </DraggableBottomSheet>
}

function ParentControlsSheet({ visible, family, members, children, currentUserId, isOwner, onInvite, onManageChildren, onManageMissions, onAddMission, onManageRewards, onReview, onSignOut, onDismiss }) {
  return <DraggableBottomSheet visible={visible} title="Parent controls" onDismiss={onDismiss}>
    <Text style={styles.parentSectionTitle}>Family</Text>
    <Text style={styles.parentHouseholdName}>{family?.name || 'Household not loaded'}</Text>
    <Text style={styles.parentMemberLabel}>Parents</Text>
    {(members || []).map((member) => <Text key={member.parent_id} style={styles.parentMember}>{member.parent_id === currentUserId ? 'You' : 'Another parent'}</Text>)}
    {isOwner ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={onInvite}><Text>Invite another parent</Text></Pressable> : null}
    <Text style={styles.parentSectionTitle}>Children</Text>
    <Text style={styles.body}>{children?.length === 1 ? '1 child in this household' : `${children?.length || 0} children in this household`}</Text>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onManageChildren}><Text>Manage children</Text></Pressable>
    <Text style={styles.parentSectionTitle}>Missions</Text>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onManageMissions}><Text>Manage missions</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onAddMission}><Text>Add mission</Text></Pressable>
    <Text style={styles.parentSectionTitle}>Rewards</Text>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onManageRewards}><Text>Manage rewards</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={onReview}><Text>Review today’s missions</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.signOut} onPress={onSignOut}><Text>Sign out</Text></Pressable>
  </DraggableBottomSheet>
}

function ChildrenSheet({ visible, children, selectedChildId, showAdd, onSelect, onAdd, onDismiss }) {
  return <DraggableBottomSheet visible={visible} title="Children" onDismiss={onDismiss}>
    <Text style={styles.body}>Choose whose stars you want to see. Each child has their own stars and reward progress.</Text>
    {(children || []).map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: item.id === selectedChildId }} style={[styles.childChoice, item.id === selectedChildId && styles.childChoiceSelected]} onPress={() => { onSelect(item.id); onDismiss() }}><Text style={styles.childChoiceName}>{item.name}</Text><Text style={styles.childChoiceStatus}>{item.id === selectedChildId ? 'Viewing now' : 'View this child'}</Text></Pressable>)}
    {showAdd ? <Pressable accessibilityRole="button" style={styles.primary} onPress={onAdd}><Text style={styles.primaryText}>Add child</Text></Pressable> : null}
  </DraggableBottomSheet>
}

function AddChildSheet({ visible, familyId, onSaved, onDismiss }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(''); setBusy(false); setError('')
  }, [visible])

  async function save() {
    const childName = name.trim()
    if (!childName || childName.length > 80) { setError('Enter a child name up to 80 characters.'); return }
    setBusy(true); setError('')
    try {
      const result = await supabase.from('children').insert({ family_id: familyId, name: childName }).select('id, name, selected_reward_id, archived_at').single()
      const saved = await onSaved(unwrap(result))
      if (!saved) throw new Error('Could not refresh the household. Please try again.')
    } catch (problem) {
      setError(friendlyError(problem, 'Could not add this child. Please try again.'))
    } finally { setBusy(false) }
  }

  return <DraggableBottomSheet visible={visible} title="Add child" onDismiss={onDismiss}>
    <Text style={styles.body}>Add a child to this household. Their stars and rewards will be separate.</Text>
    <TextInput accessibilityLabel="Child name" autoCapitalize="words" maxLength={80} placeholder="Child name" value={name} onChangeText={setName} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.missionBusy]} onPress={save}><Text style={styles.primaryText}>{busy ? 'Adding…' : 'Add child'}</Text></Pressable>
  </DraggableBottomSheet>
}

function RewardEditorSheet({ visible, familyId, reward, onSaved, onDismiss }) {
  const [name, setName] = useState('')
  const [starCost, setStarCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(reward?.name || '')
    setStarCost(reward ? String(reward.star_cost) : '')
    setBusy(false); setError('')
  }, [visible, reward])

  async function save() {
    if (busy) return
    let normalized
    try { normalized = normalizeRewardDraft(name, starCost) } catch (problem) { setError(problem.message); return }
    setBusy(true); setError('')
    try {
      const result = reward
        ? await supabase.from('rewards').update({ name: normalized.name, star_cost: normalized.starCost }).eq('id', reward.id)
        : await supabase.from('rewards').insert({ family_id: familyId, name: normalized.name, star_cost: normalized.starCost })
      if (result.error) throw result.error
      await onSaved()
    } catch (problem) { setError(friendlyError(problem, 'Could not save this reward. Please try again.')) } finally { setBusy(false) }
  }

  return <DraggableBottomSheet visible={visible} title={reward ? 'Edit reward' : 'Add reward'} onDismiss={onDismiss}>
    <Text style={styles.body}>Reward name</Text>
    <TextInput accessibilityLabel="Reward name" autoCapitalize="sentences" maxLength={80} placeholder="Movie night" value={name} onChangeText={setName} style={styles.input} />
    <Text style={styles.body}>How many stars?</Text>
    <TextInput accessibilityLabel="Reward star cost" keyboardType="number-pad" maxLength={5} placeholder="10" value={starCost} onChangeText={setStarCost} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.missionBusy]} onPress={save}><Text style={styles.primaryText}>{busy ? 'Saving…' : reward ? 'Save reward' : 'Add reward'}</Text></Pressable>
  </DraggableBottomSheet>
}

function ManageRewardsSheet({ visible, rewards, familyId, onAdd, onEdit, onRefresh, onDismiss }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const activeRewards = (rewards || []).filter((reward) => !reward.archived_at)
  const archivedRewards = (rewards || []).filter((reward) => reward.archived_at)

  async function setArchived(reward, archived) {
    setBusyId(reward.id); setError('')
    try {
      const result = await supabase.from('rewards').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', reward.id)
      if (result.error) throw result.error
      await onRefresh()
    } catch (problem) { setError(friendlyError(problem, 'Could not update this reward. Please try again.')) } finally { setBusyId(null) }
  }

  async function addStarters() {
    setBusyId('starters'); setError('')
    try {
      const result = await supabase.from('rewards').insert(starterRewards.map((reward) => ({ family_id: familyId, name: reward.name, star_cost: reward.starCost })))
      if (result.error) throw result.error
      await onRefresh()
    } catch (problem) { setError(friendlyError(problem, 'Could not add starter rewards. Please try again.')) } finally { setBusyId(null) }
  }

  const rewardRow = (reward, archived) => <View key={reward.id} style={[styles.manageRewardRow, archived && styles.manageRewardRowArchived]}><Text style={styles.manageRewardEmoji}>{rewardPresentation(reward.name).emoji}</Text><View style={styles.manageRewardDetails}><Text numberOfLines={2} style={styles.manageRewardName}>{reward.name}</Text><Text style={styles.manageRewardMeta}>{reward.star_cost} stars{archived ? ' · Archived' : ''}</Text></View><View><Pressable accessibilityRole="button" disabled={Boolean(busyId)} style={styles.smallAction} onPress={() => onEdit(reward)}><Text>Edit</Text></Pressable><Pressable accessibilityRole="button" disabled={Boolean(busyId)} style={styles.smallAction} onPress={() => setArchived(reward, !archived)}><Text style={archived ? styles.restoreText : styles.deleteText}>{busyId === reward.id ? 'Saving…' : archived ? 'Restore' : 'Archive'}</Text></Pressable></View></View>

  return <DraggableBottomSheet visible={visible} title="Manage rewards" onDismiss={onDismiss}>
    <Pressable accessibilityRole="button" style={styles.primary} disabled={Boolean(busyId)} onPress={onAdd}><Text style={styles.primaryText}>Add reward</Text></Pressable>
    {!activeRewards.length && !archivedRewards.length ? <Pressable accessibilityRole="button" style={styles.secondary} disabled={Boolean(busyId)} onPress={addStarters}><Text>{busyId === 'starters' ? 'Adding…' : 'Add starter rewards'}</Text></Pressable> : null}
    <Text style={styles.body}>Choose the rewards your child can work toward and how many stars each one needs.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {activeRewards.map((reward) => rewardRow(reward, false))}
    {!activeRewards.length && archivedRewards.length ? <Text style={styles.body}>No active rewards yet. Restore one or add a new reward.</Text> : null}
    {archivedRewards.length ? <><Text style={styles.parentMemberLabel}>Archived rewards</Text>{archivedRewards.map((reward) => rewardRow(reward, true))}</> : null}
  </DraggableBottomSheet>
}

function MissionEditorSheet({ visible, familyId, mission, onSaved, onDismiss }) {
  const [name, setName] = useState('')
  const [iconKey, setIconKey] = useState('star')
  const [cooldown, setCooldown] = useState(120)
  const [customMinutes, setCustomMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(mission?.name || '')
    setIconKey(mission?.icon_key || 'star')
    setCooldown(Number(mission?.repeat_cooldown_seconds || 120))
    setCustomMinutes(mission && !cooldownPresets.includes(Number(mission.repeat_cooldown_seconds)) ? String(Number(mission.repeat_cooldown_seconds) / 60) : '')
    setError('')
  }, [visible, mission])

  function chooseCustom(value) {
    setCustomMinutes(value)
    const seconds = Math.round(Number(value) * 60)
    setCooldown(value.trim() ? seconds : NaN)
  }

  async function save() {
    if (busy) return
    const title = name.trim()
    if (!title || title.length > 80) { setError('Enter a mission name up to 80 characters.'); return }
    if (!missionIconOptions.some(([key]) => key === iconKey)) { setError('Choose an icon.'); return }
    if (!Number.isInteger(cooldown) || cooldown < 60 || cooldown > 43200) { setError('Choose a cooldown between 1 minute and 12 hours.'); return }
    setBusy(true); setError('')
    const values = { name: title, ...missionVisualFields(iconKey), frequency: 'repeatable', repeat_cooldown_seconds: cooldown }
    try {
      const result = mission
        ? await supabase.from('missions').update(values).eq('id', mission.id)
        : await supabase.from('missions').insert({ family_id: familyId, stars: 1, ...values })
      if (result.error) throw result.error
      await onSaved()
    } catch (problem) {
      setError(friendlyError(problem, 'Could not save this mission. Please try again.'))
    } finally { setBusy(false) }
  }

  return <DraggableBottomSheet visible={visible} title={mission ? 'Edit mission' : 'Add mission'} onDismiss={onDismiss}>
    <Text style={styles.body}>Mission name</Text>
    <TextInput accessibilityLabel="Mission name" maxLength={80} placeholder="Feed the cat" value={name} onChangeText={setName} style={styles.input} />
    <Text style={styles.body}>Mission icon</Text>
    <View style={styles.iconPicker}>{missionIconOptions.map(([key, icon, label]) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: iconKey === key }} onPress={() => setIconKey(key)} style={[styles.iconChoice, iconKey === key && styles.iconChoiceSelected]}><Text style={styles.iconChoiceText}>{icon}</Text></Pressable>)}</View>
    <Text style={styles.body}>Cooldown</Text>
    <View style={styles.cooldownPicker}>{cooldownPresets.map((seconds) => <Pressable key={seconds} accessibilityRole="button" accessibilityState={{ selected: cooldown === seconds }} onPress={() => { setCooldown(seconds); setCustomMinutes('') }} style={[styles.cooldownChoice, cooldown === seconds && styles.cooldownChoiceSelected]}><Text style={styles.cooldownChoiceText}>{formatCooldown(seconds)}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="Custom cooldown in minutes" keyboardType="numeric" placeholder="Custom minutes" value={customMinutes} onChangeText={chooseCustom} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.missionBusy]} onPress={save}><Text style={styles.primaryText}>{busy ? 'Saving…' : mission ? 'Save mission' : 'Add mission'}</Text></Pressable>
  </DraggableBottomSheet>
}

function MissionDragHandle({ mission, disabled, onStart, onMove, onEnd, onCancel, onNudge }) {
  const latest = useRef(null)
  latest.current = { mission, disabled, onStart, onMove, onEnd, onCancel, onNudge }
  const timer = useRef(null)
  const dragging = useRef(false)
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: (event) => {
      const pageY = event.nativeEvent.pageY
      timer.current = setTimeout(() => { dragging.current = latest.current.onStart(latest.current.mission.id, pageY) }, 180)
    },
    onPanResponderMove: (event, gesture) => {
      if (dragging.current) latest.current.onMove(event.nativeEvent.pageY)
      else if (Math.abs(gesture.dy) > 8) clearTimeout(timer.current)
    },
    onPanResponderRelease: () => {
      clearTimeout(timer.current)
      if (dragging.current) { dragging.current = false; void latest.current.onEnd() }
    },
    onPanResponderTerminate: () => { clearTimeout(timer.current); dragging.current = false; latest.current.onCancel() },
    onPanResponderTerminationRequest: () => !dragging.current,
    onShouldBlockNativeResponder: () => dragging.current,
  })).current
  useEffect(() => () => clearTimeout(timer.current), [])
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={`Reorder ${mission.name}`} accessibilityHint="Hold and drag up or down to change mission order" accessibilityState={{ disabled }} accessibilityActions={[{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }]} onAccessibilityAction={(event) => { if (!disabled) void onNudge(mission.id, event.nativeEvent.actionName === 'increment' ? 1 : -1) }} style={styles.missionDragHandle}><Text style={styles.missionDragGlyph}>{'\u2261'}</Text></View>
}

function ManageMissionsSheet({ visible, missions, onAdd, onEdit, onDelete, onReorder, onDismiss }) {
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletingRef = useRef(false)
  const [orderError, setOrderError] = useState('')
  const activeMissions = sortMissions(missions || []).filter((mission) => !mission.archived_at)
  const reordering = useMissionDrag({ missions: activeMissions, visible, disabled: Boolean(deleteTarget), onReorder, onError: setOrderError })
  const controlsBusy = deleting || reordering.saving || Boolean(reordering.drag)


  function cancelDelete() {
    if (deletingRef.current) return
    setDeleteTarget(null); setDeleteError('')
  }

  async function confirmDelete() {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true); setDeleteError('')
    try {
      await onDelete(deleteTarget)
      setDeleteTarget(null)
    } catch (problem) {
      setDeleteError(friendlyError(problem, 'Could not delete this mission. Please try again.'))
    } finally { deletingRef.current = false; setDeleting(false) }
  }

  return <>
    <DraggableBottomSheet visible={visible} title="Manage missions" scrollRef={reordering.scrollRef} scrollEnabled={!reordering.drag} onScroll={reordering.onScroll} onScrollLayout={reordering.measureViewport} onContentSizeChange={reordering.onContentSizeChange} onDismiss={() => { reordering.cancel(); cancelDelete(); onDismiss() }}>
      <Pressable accessibilityRole="button" style={styles.primary} disabled={controlsBusy} onPress={onAdd}><Text style={styles.primaryText}>Add mission</Text></Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{reordering.saving ? 'Saving order...' : 'Hold a handle to drag missions into order.'}</Text>
      {orderError ? <Text accessibilityRole="alert" style={styles.error}>{orderError}</Text> : null}
      <View style={{ height: Math.max(0, activeMissions.length * MISSION_ROW_STEP - 14) }}>
        {activeMissions.map((mission, index) => {
          const drag = reordering.drag
          const isDragging = drag?.id === mission.id
          const offset = drag ? (isDragging ? drag.delta : missionRowOffset(index, drag.from, drag.to)) : 0
          return <View key={mission.id} style={[styles.manageMissionRow, { position: 'absolute', top: index * MISSION_ROW_STEP, left: 0, right: 0, height: MISSION_ROW_HEIGHT, transform: [{ translateY: offset }], zIndex: isDragging ? 2 : 0 }, isDragging && styles.missionRowDragging]}>
            <MissionDragHandle mission={mission} disabled={reordering.saving || Boolean(deleteTarget) || Boolean(drag && !isDragging)} onStart={(id, y) => { setOrderError(''); return reordering.begin(id, y) }} onMove={reordering.move} onEnd={reordering.end} onCancel={reordering.cancel} onNudge={reordering.nudge} />
            <Text style={styles.manageMissionIcon}>{missionIcon(mission)}</Text><View style={styles.manageMissionDetails}><Text numberOfLines={2} style={styles.manageMissionName}>{mission.name}</Text><Text style={styles.manageMissionMeta}>{formatCooldown(Number(mission.repeat_cooldown_seconds || 120))}</Text></View><View><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${mission.name}`} disabled={controlsBusy} style={styles.smallAction} onPress={() => onEdit(mission)}><Text>Edit</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${mission.name}`} disabled={controlsBusy} style={styles.smallAction} onPress={() => { setDeleteError(''); setDeleteTarget(mission) }}><Text style={styles.deleteText}>Delete</Text></Pressable></View>
          </View>
        })}
      </View>
    </DraggableBottomSheet>
    <Modal visible={visible && Boolean(deleteTarget)} transparent animationType="fade" onRequestClose={cancelDelete}>
      <View style={styles.confirmShade}><View accessibilityViewIsModal style={styles.confirmCard}>
        <Text accessibilityRole="header" style={styles.confirmTitle}>Delete mission?</Text>
        <Text style={styles.body}>Are you sure you want to delete this mission?</Text>
        {deleteError ? <Text accessibilityRole="alert" style={styles.confirmError}>{deleteError}</Text> : null}
        <View style={styles.confirmActions}>
          <Pressable accessibilityRole="button" disabled={deleting} style={styles.cancelButton} onPress={cancelDelete}><Text style={styles.cancelButtonText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={deleting} accessibilityState={{ busy: deleting }} style={[styles.confirmButton, styles.deleteButton, deleting && styles.missionBusy]} onPress={confirmDelete}><Text style={styles.confirmButtonText}>Delete</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </>
}

function Home({ data, refresh, onSignOut, loadError }) {
  const [pendingMissionIds, setPendingMissionIds] = useState([])
  const awardInFlight = useRef(new Set())
  const [celebrating, setCelebrating] = useState(false)
  const [celebrationRun, setCelebrationRun] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [childrenOpen, setChildrenOpen] = useState(false)
  const [childrenSheetMode, setChildrenSheetMode] = useState('switch')
  const [addChildOpen, setAddChildOpen] = useState(false)
  const [selectedChildId, setSelectedChildId] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageMissionsOpen, setManageMissionsOpen] = useState(false)
  const [manageRewardsOpen, setManageRewardsOpen] = useState(false)
  const [editingReward, setEditingReward] = useState(null)
  const [deletedMissionIds, setDeletedMissionIds] = useState([])
  const [missionOrder, setMissionOrder] = useState(null)
  const [editingMission, setEditingMission] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [redeemAttempt, setRedeemAttempt] = useState(null)
  const [redeemedReward, setRedeemedReward] = useState(null)
  const [redeeming, setRedeeming] = useState(false)
  const [redemptionError, setRedemptionError] = useState('')
  const [error, setError] = useState('')
  const [balanceTarget, setBalanceTarget] = useState(null)
  const [bounceAfterCelebration, setBounceAfterCelebration] = useState(false)
  const [optimisticAwards, setOptimisticAwards] = useState([])
  const [optimisticSpends, setOptimisticSpends] = useState([])
  const { width: screenWidth } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const balanceScale = useRef(new Animated.Value(1)).current
  const previousBalance = useRef(null)
  const children = Array.isArray(data?.children) ? data.children : []
  const sourceMissions = Array.isArray(data?.missions) ? data.missions : []
  const missions = sortMissions(sourceMissions.map((mission) => missionOrder && missionOrder.includes(mission.id) ? { ...mission, sort_order: (missionOrder.indexOf(mission.id) + 1) * 10 } : mission)).filter((mission) => !deletedMissionIds.includes(mission.id))
  const rewards = Array.isArray(data?.rewards) ? data.rewards : []
  const balances = Array.isArray(data?.balances) ? data.balances : []
  const completions = Array.isArray(data?.completions) ? data.completions : []
  const redemptions = Array.isArray(data?.redemptions) ? data.redemptions : []
  const child = children.find((item) => item.id === selectedChildId) || children[0] || null
  const savedRequestIds = new Set(completions.map((event) => event.request_id).filter(Boolean))
  const activeOptimisticAwards = optimisticAwards.filter((event) => event.child_id === child?.id && !savedRequestIds.has(event.request_id))
  const savedRedemptionRequestIds = new Set(redemptions.map((event) => event.request_id).filter(Boolean))
  const activeOptimisticSpends = optimisticSpends.filter((event) => event.child_id === child?.id && !savedRedemptionRequestIds.has(event.request_id))
  const activityEvents = [...activeOptimisticAwards, ...completions.filter((event) => event.child_id === child?.id)].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
  const savedBalance = Number(balances.find((row) => row.child_id === child?.id)?.balance || 0)
  const balance = savedBalance + activeOptimisticAwards.reduce((total, event) => total + event.stars_earned, 0) - activeOptimisticSpends.reduce((total, event) => total + event.stars_spent, 0)
  const activeMissions = missions.filter((mission) => !mission.archived_at)
  const cardWidth = Math.floor((Math.min(screenWidth - (insets.left || 0) - (insets.right || 0), 600) - 58) / 3)
  const localDay = data?.family?.time_zone ? new Intl.DateTimeFormat('en-CA', { timeZone: data.family.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) : ''
  const completionToday = (mission) => activityEvents.find((event) => event.mission_id === mission.id && event.completed_on === localDay && !event.undone_at)
  const reviewableMissions = activeMissions.filter((mission) => Boolean(completionToday(mission)))
  const latestCompletion = (mission) => activityEvents.find((event) => event.mission_id === mission.id && !event.undone_at)
  const cooldownRemaining = (mission) => {
    const completedAt = latestCompletion(mission)?.completed_at
    const cooldownSeconds = Number(mission.repeat_cooldown_seconds ?? 120)
    if (!completedAt || cooldownSeconds <= 0) return 0
    return Math.max(0, new Date(completedAt).getTime() + cooldownSeconds * 1000 - Date.now())
  }
  const cooldownProgress = (mission) => {
    const cooldownSeconds = Number(mission.repeat_cooldown_seconds ?? 120)
    return cooldownSeconds > 0 ? Math.min(1, cooldownRemaining(mission) / (cooldownSeconds * 1000)) : 0
  }
  const [, setClock] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (previousBalance.current === null) { previousBalance.current = balance; return }
    if (previousBalance.current === balance) return
    previousBalance.current = balance
  }, [balance])

  async function reorderMissions(ids) {
    const before = activeMissions.map((mission) => mission.id)
    if (before.every((id, index) => id === ids[index])) return
    const previous = missionOrder
    setMissionOrder(ids)
    try { await saveMissionOrder(supabase, data.family.id, before, ids) }
    catch (problem) { setMissionOrder(previous); void refresh(); throw problem }
    const result = await refresh()
    if (result.ok) setMissionOrder(null)
  }

  async function removeMission(mission) {
    setDeletedMissionIds((ids) => [...ids, mission.id])
    try {
      await softDeleteMission(supabase, mission.id)
    } catch (problem) {
      setDeletedMissionIds((ids) => ids.filter((id) => id !== mission.id))
      throw problem
    }
    // Keep it hidden even if refresh fails or returns a stale response.
    void refresh()
  }

  function finishCelebration() {
    setCelebrating(false)
    if (!bounceAfterCelebration) return
    setBounceAfterCelebration(false)
    balanceScale.setValue(1)
    Animated.sequence([Animated.spring(balanceScale, { toValue: 1.14, tension: 190, friction: 4, useNativeDriver: true }), Animated.spring(balanceScale, { toValue: 1, tension: 170, friction: 5, useNativeDriver: true })]).start()
  }

  async function award(mission) {
    if (!child || awardInFlight.current.has(mission.id) || pendingMissionIds.includes(mission.id) || cooldownRemaining(mission) > 0) return
    awardInFlight.current.add(mission.id)
    recordBalanceTarget()
    const requestId = Crypto.randomUUID()
    const optimisticEvent = {
      id: `optimistic-${requestId}`,
      request_id: requestId,
      child_id: child.id,
      mission_id: mission.id,
      completed_at: new Date().toISOString(),
      completed_on: localDay,
      frequency_snapshot: mission.frequency,
      stars_earned: Number(mission.stars),
      undone_at: null,
    }
    setPendingMissionIds((ids) => [...ids, mission.id]); setError('')
    setOptimisticAwards((events) => [...events, optimisticEvent])
    setBounceAfterCelebration(true); setCelebrating(true); setCelebrationRun((current) => current + 1)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    try {
      unwrap(await supabase.rpc('award_mission', { p_child_id: child.id, p_mission_id: mission.id, p_request_id: requestId }))
      const refreshResult = await refresh()
      if (!refreshResult.ok) {
        setError('Star saved. We will refresh it when the connection returns.')
      } else {
        setOptimisticAwards((events) => events.filter((event) => event.request_id !== requestId))
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (problem) {
      setOptimisticAwards((events) => events.filter((event) => event.request_id !== requestId))
      setBounceAfterCelebration(false); setCelebrating(false)
      setError(friendlyError(problem, 'That star could not be saved. Please try again.'))
    } finally { awardInFlight.current.delete(mission.id); setPendingMissionIds((ids) => ids.filter((id) => id !== mission.id)) }
  }

  async function undo(mission) {
    const completion = completionToday(mission)
    if (!completion || pendingMissionIds.includes(mission.id)) return
    setPendingMissionIds((ids) => [...ids, mission.id]); setError('')
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      unwrap(await supabase.rpc('undo_completion', { p_completion_id: completion.id, p_request_id: Crypto.randomUUID() }))
      const refreshResult = await refresh()
      if (!refreshResult.ok) throw new Error(refreshResult.error)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (problem) { setError(friendlyError(problem)) } finally { setPendingMissionIds((ids) => ids.filter((id) => id !== mission.id)) }
  }

  function startRedemption(reward) {
    if (!child || balance < reward.stars || redeeming) return
    setRedemptionError('')
    setRedeemAttempt({ reward, requestId: Crypto.randomUUID() })
  }

  async function confirmRedemption() {
    if (!child || !redeemAttempt || redeeming) return
    const { reward, requestId } = redeemAttempt
    setRedeeming(true); setRedemptionError('')
    try {
      unwrap(await supabase.rpc('redeem_reward', { p_child_id: child.id, p_reward_id: reward.id, p_request_id: requestId }))
      setOptimisticSpends((spends) => [...spends, { request_id: requestId, child_id: child.id, stars_spent: reward.stars }])
      await refresh()
      setRedeemAttempt(null)
      setRedeemedReward({ ...reward, requestId })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (problem) {
      const message = /not enough stars/i.test(problem.message || '')
        ? 'Not enough stars for this reward yet.'
        : 'That reward could not be redeemed. Please try again.'
      setRedemptionError(friendlyError(problem, message)); setError(message)
    } finally { setRedeeming(false) }
  }

  const balanceRef = useRef(null)
  const recordBalanceTarget = () => balanceRef.current?.measureInWindow((x, y, width, height) => setBalanceTarget({ x: x + width / 2, y: y + height / 2 }))

  return <View style={styles.safe}>
    <View style={[styles.home, { paddingTop: Math.max(insets.top, 12) + 6, width: Math.min(screenWidth - (insets.left || 0) - (insets.right || 0), 600) }]}><View style={styles.homeHeader}>
      <View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Switch child" accessibilityHint="Choose another child" hitSlop={8} style={styles.childSwitcher} onPress={() => { setChildrenSheetMode('switch'); setChildrenOpen(true) }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.name}>{child?.name || 'Little Star'}</Text>{children.length > 1 ? <Text style={styles.childSwitcherChevron}>⌄</Text> : null}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="Parent settings" hitSlop={8} style={styles.cog} onPress={() => setSettingsOpen(true)}><Text style={styles.cogText}>⚙︎</Text></Pressable></View>
      <Animated.View style={[styles.balanceWrap, { transform: [{ scale: balanceScale }] }]}><View pointerEvents="none" style={[styles.balanceAccent, styles.balanceAccentLeft]}><View style={[styles.accentLine, styles.accentLineOne]} /><View style={[styles.accentLine, styles.accentLineTwo]} /><View style={[styles.accentLine, styles.accentLineThree]} /></View><Pressable accessibilityRole="button" accessibilityLabel="Open rewards" accessibilityHint={`${balance} stars. See star rewards`} ref={balanceRef} style={styles.balance} onLayout={recordBalanceTarget} onPress={() => setRewardsOpen(true)}><Text style={styles.balanceStar}>{'\u2605'}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.balanceNumber}>{balance}</Text><Text style={styles.balanceLabel}>stars</Text><Text style={styles.balanceChevron}>{'›'}</Text></Pressable><View pointerEvents="none" style={[styles.balanceAccent, styles.balanceAccentRight]}><View style={[styles.accentLine, styles.accentLineThree]} /><View style={[styles.accentLine, styles.accentLineTwo]} /><View style={[styles.accentLine, styles.accentLineOne]} /></View></Animated.View>
      {child ? <>{error || loadError ? <Text accessibilityRole="alert" style={styles.error}>{error || loadError}</Text> : null}</> : null}
      </View>
      {child ? <><View style={styles.missionViewport}><ScrollView style={styles.missionScroll} contentContainerStyle={styles.missionScrollContent} horizontal={false} showsHorizontalScrollIndicator={false} directionalLockEnabled removeClippedSubviews={false}><View style={styles.grid}>{activeMissions.map((mission) => {
  const busy = pendingMissionIds.includes(mission.id)
  const coolingDown = cooldownRemaining(mission) > 0
  const progress = cooldownProgress(mission)
  const label = displayMissionName(mission)

  return <Pressable key={mission.id} accessibilityRole="button" accessibilityLabel={`Complete ${label}`} accessibilityHint={coolingDown ? 'Ready again shortly' : 'Earn one star'} disabled={busy || coolingDown} onPress={() => award(mission)} style={({ pressed }) => [styles.mission, { width: cardWidth }, pressed && !coolingDown && styles.missionPressed, (busy || coolingDown) && styles.missionBusy]}><Text style={styles.missionEmoji}>{missionIcon(mission)}</Text><Text numberOfLines={2} style={styles.missionName}>{label}</Text>{busy ? <Text style={styles.missionBusyText}>{'\u2026'}</Text> : coolingDown ? <View style={styles.cooldown}><View style={styles.cooldownTrack}><View style={[styles.cooldownFill, { width: `${Math.round(progress * 100)}%` }]} /></View><Text style={styles.cooldownText}>Ready soon</Text></View> : <View style={styles.readyPill}><Text style={styles.readyText}>Ready!</Text></View>}</Pressable>
})}</View>{!activeMissions.length ? <View style={styles.empty}><Text style={styles.parentSectionTitle}>Ready to get started?</Text><Text style={styles.body}>Add a mission in Parent Controls.</Text></View> : null}</ScrollView></View><View style={[styles.homeFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}><View style={styles.encouragement}><Text style={styles.encouragementText}>You’re doing amazing!</Text><Text style={styles.encouragementHeart}>{'♥'}</Text></View></View></> : <View style={styles.empty}><Text style={styles.sheetTitle}>Set up a child profile</Text><Text style={styles.body}>This household does not have an active child profile yet.</Text><Pressable accessibilityRole="button" style={styles.secondary} onPress={refresh}><Text>Try again</Text></Pressable></View>}
    </View>
    <Celebration visible={celebrating} balanceTarget={balanceTarget} run={celebrationRun} onFinish={finishCelebration} />
    <ParentControlsSheet visible={settingsOpen} family={data?.family} members={data?.members} children={children} currentUserId={data?.userId} isOwner={data?.membership?.role === 'owner'} onInvite={() => setInviteOpen(true)} onManageChildren={() => { setChildrenSheetMode('manage'); setChildrenOpen(true) }} onManageMissions={() => setManageMissionsOpen(true)} onAddMission={() => setEditingMission({})} onManageRewards={() => setManageRewardsOpen(true)} onReview={() => setReviewOpen(true)} onSignOut={onSignOut} onDismiss={() => setSettingsOpen(false)} />
    <ChildrenSheet visible={childrenOpen} children={children} selectedChildId={child?.id} showAdd={childrenSheetMode === 'manage'} onSelect={setSelectedChildId} onAdd={() => setAddChildOpen(true)} onDismiss={() => setChildrenOpen(false)} />
    <AddChildSheet visible={addChildOpen} familyId={data?.family?.id} onSaved={async (newChild) => { const result = await refresh(); setSelectedChildId(newChild.id); setAddChildOpen(false); setChildrenOpen(false); if (!result.ok) setError('Child added. Refresh to view their stars.'); return true }} onDismiss={() => setAddChildOpen(false)} />
    <InviteParentSheet visible={inviteOpen} familyId={data?.family?.id} onDismiss={() => setInviteOpen(false)} />
    <ManageRewardsSheet visible={manageRewardsOpen} rewards={rewards} familyId={data?.family?.id} onAdd={() => setEditingReward({})} onEdit={setEditingReward} onRefresh={refresh} onDismiss={() => setManageRewardsOpen(false)} />
    <RewardEditorSheet visible={editingReward !== null} familyId={data?.family?.id} reward={editingReward?.id ? editingReward : null} onSaved={async () => { await refresh(); setEditingReward(null); setManageRewardsOpen(false) }} onDismiss={() => setEditingReward(null)} />
    <ManageMissionsSheet visible={manageMissionsOpen} missions={missions} onAdd={() => setEditingMission({})} onEdit={setEditingMission} onDelete={removeMission} onReorder={reorderMissions} onDismiss={() => setManageMissionsOpen(false)} />
    <MissionEditorSheet visible={editingMission !== null} familyId={data?.family?.id} mission={editingMission?.id ? editingMission : null} onSaved={async () => { await refresh(); setEditingMission(null); setManageMissionsOpen(false) }} onDismiss={() => setEditingMission(null)} />
    <DraggableBottomSheet visible={reviewOpen} title="Today's missions" onDismiss={() => setReviewOpen(false)}>
      <Text style={styles.body}>Undo only a mistaken tap.</Text>
      {reviewableMissions.length ? reviewableMissions.map((mission) => <View key={mission.id} style={styles.reviewRow}><Text style={styles.reviewMission}>{missionIcon(mission)} {displayMissionName(mission)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Undo ${displayMissionName(mission)}`} disabled={pendingMissionIds.includes(mission.id)} style={styles.reviewUndo} onPress={() => undo(mission)}><Text style={styles.reviewUndoText}>Undo</Text></Pressable></View>) : <Text style={styles.body}>No activities to review today.</Text>}
    </DraggableBottomSheet>
    <RewardsScreen visible={rewardsOpen} balance={balance} rewards={rewards} onBack={() => setRewardsOpen(false)} onRedeem={startRedemption} />
    <Modal visible={Boolean(redeemAttempt)} transparent animationType="fade" onRequestClose={() => !redeeming && setRedeemAttempt(null)}><View style={styles.confirmShade}><View style={styles.confirmCard}><Text style={styles.confirmEmoji}>{redeemAttempt?.reward.emoji}</Text><Text style={styles.confirmTitle}>Redeem {redeemAttempt?.reward.name}?</Text><Text style={styles.body}>This uses {redeemAttempt?.reward.stars} stars. A grown-up should confirm.</Text>{redemptionError ? <Text accessibilityRole="alert" style={styles.confirmError}>{redemptionError}</Text> : null}<View style={styles.confirmActions}><Pressable accessibilityRole="button" disabled={redeeming} style={styles.cancelButton} onPress={() => setRedeemAttempt(null)}><Text style={styles.cancelButtonText}>Not now</Text></Pressable><Pressable accessibilityRole="button" disabled={redeeming} style={styles.confirmButton} onPress={confirmRedemption}><Text style={styles.confirmButtonText}>{redeeming ? 'Redeeming…' : 'Yes, redeem'}</Text></Pressable></View></View></View></Modal>
    <RedemptionSuccess reward={redeemedReward} onHome={() => { setRedeemedReward(null); setRewardsOpen(false) }} onRewards={() => setRedeemedReward(null)} />
  </View>
}
function AppContent() {
  const [session, setSession] = useState(null)
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [pendingInviteToken, setPendingInviteToken] = useState(null)
  const [inviteClaim, setInviteClaim] = useState({ loading: false, error: '' })
  const [inviteDecision, setInviteDecision] = useState(null)
  async function load({ keepScreen = false } = {}) {
    try {
      if (!keepScreen) setState((old) => ({ ...old, loading: true, error: '' }))
      // RLS permits only current memberships. The explicit filter also keeps
      // historical, inactive rows from participating in household selection.
      const { user } = unwrap(await supabase.auth.getUser())
      if (!user) throw new Error('Your sign-in session could not be verified. Please sign in again.')
      const returnedMemberships = unwrap(await supabase.from('family_memberships').select('family_id, parent_id, role, left_at').eq('parent_id', user.id).is('left_at', null).order('joined_at')) || []
      const memberships = returnedMemberships.filter((membership) => membership.left_at === null)
      if (!memberships.length) throw new Error('This account does not belong to a family yet.')
      if (memberships.length > 1) throw new Error('This account has more than one active household. Please finish household setup in the web app.')
      const familyId = memberships[0].family_id
      const [family, children, missions, rewards, balances, completions, redemptions, members] = await Promise.all([supabase.from('families').select('id, name, time_zone').eq('id', familyId).single(), supabase.from('children').select('id, name, selected_reward_id, archived_at').eq('family_id', familyId).is('archived_at', null).order('created_at'), supabase.from('missions').select('id, family_id, category_id, name, icon_key, stars, frequency, repeat_cooldown_seconds, archived_at, created_at, sort_order').eq('family_id', familyId).order('sort_order').order('created_at').order('id'), supabase.from('rewards').select('id, name, star_cost, archived_at').eq('family_id', familyId).order('created_at'), supabase.from('child_star_balances').select('child_id, balance').eq('family_id', familyId), supabase.from('mission_completions').select('id, request_id, child_id, mission_id, completed_at, completed_on, frequency_snapshot, undone_at').eq('family_id', familyId).order('completed_at', { ascending: false }), supabase.from('reward_redemptions').select('id, request_id, child_id, redeemed_at, stars_spent').eq('family_id', familyId).order('redeemed_at', { ascending: false }), supabase.from('family_memberships').select('parent_id, role, left_at').eq('family_id', familyId).is('left_at', null).order('joined_at')])
      const familyData = unwrap(family)
      if (!familyData) throw new Error('Your household could not be loaded. Please try again.')
      setState({ loading: false, error: '', data: { family: familyData, membership: memberships[0], members: unwrap(members) || [], userId: user.id, children: unwrap(children) || [], missions: unwrap(missions) || [], rewards: unwrap(rewards) || [], balances: unwrap(balances) || [], completions: unwrap(completions) || [], redemptions: unwrap(redemptions) || [], email: session?.user.email || '' } })
      return { ok: true }
    } catch (error) {
      const message = friendlyError(error)
      setState((old) => ({ loading: false, data: keepScreen ? old.data : null, error: message }))
      return { ok: false, error: error.message }
    }
  }
  useEffect(() => {
    if (!supabase) return undefined
    async function receiveUrl(url) {
      const invite = householdInviteFromUrl(url)
      if (invite) setPendingInviteToken(invite)
      const tokens = authTokensFromUrl(url)
      if (tokens) await supabase.auth.setSession(tokens)
    }
    Linking.getInitialURL().then(receiveUrl).catch(() => {})
    const subscription = Linking.addEventListener('url', ({ url }) => { void receiveUrl(url) })
    return () => subscription.remove()
  }, [])
  useEffect(() => { if (!supabase) return; supabase.auth.getSession().then(({ data }) => { setSession(data.session); setState((old) => ({ ...old, loading: false })) }); const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => listener.subscription.unsubscribe() }, [])
  useEffect(() => { if (session && !pendingInviteToken) load() }, [session, pendingInviteToken])
  useEffect(() => {
    if (!session || !pendingInviteToken || inviteDecision) return
    let cancelled = false
    async function claimInvite() {
      setInviteClaim({ loading: true, error: '' })
      const result = await supabase.rpc('resolve_household_invite', { p_token: pendingInviteToken, p_confirm_empty_switch: false })
      if (cancelled) return
      if (result.error) { setInviteClaim({ loading: false, error: householdInviteError(result.error) }); return }
      const resolution = Array.isArray(result.data) ? result.data[0] : result.data
      if (!resolution?.outcome) { setInviteClaim({ loading: false, error: 'This invitation could not be accepted.' }); return }
      if (resolution.outcome === 'confirm_empty_switch' || resolution.outcome === 'manual_merge_required') {
        setInviteClaim({ loading: false, error: '' })
        setInviteDecision(resolution)
        return
      }
      setInviteClaim({ loading: false, error: '' })
      setPendingInviteToken(null)
    }
    void claimInvite()
    return () => { cancelled = true }
  }, [session, pendingInviteToken, inviteDecision])
  async function confirmEmptyHouseholdSwitch() {
    if (!pendingInviteToken) return
    setInviteClaim({ loading: true, error: '' })
    const result = await supabase.rpc('resolve_household_invite', { p_token: pendingInviteToken, p_confirm_empty_switch: true })
    if (result.error) { setInviteClaim({ loading: false, error: householdInviteError(result.error, 'This family could not be joined. Please try again.') }); return }
    const resolution = Array.isArray(result.data) ? result.data[0] : result.data
    if (!resolution?.outcome?.startsWith('joined')) { setInviteClaim({ loading: false, error: 'This family could not be joined.' }); return }
    setInviteDecision(null)
    setInviteClaim({ loading: false, error: '' })
    setPendingInviteToken(null)
  }
  function cancelInviteDecision() {
    setInviteDecision(null)
    setPendingInviteToken(null)
    setInviteClaim({ loading: false, error: '' })
  }
  if (!configured) return <SafeAreaView style={styles.safe}><View style={styles.auth}><Text style={styles.title}>Our Little Star</Text><Text style={styles.message}>{'Something went wrong. Please try again later.'}</Text></View></SafeAreaView>
  if (state.loading && !session) return <LoadingScreen />
  if (!session) return <Auth onSession={setSession} />
  if (inviteClaim.loading) return <SafeAreaView style={styles.safe}><View style={styles.auth}><ActivityIndicator size="large" color="#0E3A66" /><Text style={styles.title}>Joining your family…</Text></View></SafeAreaView>
  if (inviteClaim.error) return <SafeAreaView style={styles.safe}><View style={styles.auth}><Text style={styles.title}>Invitation unavailable</Text><Text style={styles.message}>{inviteClaim.error}</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={() => { setPendingInviteToken(null); setInviteClaim({ loading: false, error: '' }) }}><Text style={styles.primaryText}>Continue</Text></Pressable></View></SafeAreaView>
  if (inviteDecision) return <HouseholdInviteDecision decision={inviteDecision} onConfirmEmptySwitch={confirmEmptyHouseholdSwitch} onConnectFamilies={() => {}} onCancel={cancelInviteDecision} />
  if (state.loading) return <LoadingScreen />
  if (state.error && !state.data) return <SafeAreaView style={styles.safe}><View style={styles.auth}><Text style={styles.title}>Our Little Star</Text><Text style={styles.message}>{state.error}</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={load}><Text style={styles.primaryText}>Try again</Text></Pressable></View></SafeAreaView>
  if (!state.data) return <LoadingScreen />
  return <Home data={state.data} loadError={state.error} refresh={() => load({ keepScreen: true })} onSignOut={() => supabase.auth.signOut()} />
}

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#D9F1FF' },
  auth: { width: '100%', maxWidth: 600, alignSelf: 'center', flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  logo: { textAlign: 'center', fontSize: 64, color: '#D9A62A' },
  eyebrow: { color: '#7A827C', fontWeight: '800', letterSpacing: 1.5, fontSize: 11 },
  title: { fontSize: 32, fontWeight: '800', color: '#0E3A66' },
  body: { fontSize: 15, color: '#123A63', lineHeight: 22 },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE8E0', borderRadius: 16, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 9 },
  tabActive: { backgroundColor: '#FFFDF9' },
  input: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#DDD8CF', borderRadius: 16, minHeight: 50, paddingHorizontal: 14, fontSize: 16 },
  primary: { backgroundColor: '#48604E', borderRadius: 16, minHeight: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  message: { color: '#7a403e', textAlign: 'center', lineHeight: 20 },
  home: { flex: 1, minHeight: 0, width: '100%', maxWidth: 600, alignSelf: 'center' },
  homeHeader: { flexShrink: 0, paddingHorizontal: 18 },
  // The viewport takes only the space between the pinned header and footer.
  // Its absolutely bounded scroll view cannot size itself from the mission grid.
  missionViewport: { flex: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' },
  missionScroll: { ...StyleSheet.absoluteFillObject },
  missionScrollContent: { paddingHorizontal: 18, paddingBottom: 28 },
  homeFooter: { flexShrink: 0, paddingHorizontal: 18 },
  top: { minHeight: 54, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  childSwitcher: { flex: 1, minWidth: 0, marginRight: 12, flexDirection: 'row', alignItems: 'center' },
  name: { flexShrink: 1, minWidth: 0, fontSize: 42, lineHeight: 48, fontWeight: '800', color: '#123A63', letterSpacing: -0.7 },
  childSwitcherChevron: { marginLeft: 4, marginTop: 4, fontSize: 25, lineHeight: 28, color: '#456888' },
  cog: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD9EA', justifyContent: 'center', alignItems: 'center', shadowColor: '#0B2F57', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cogText: { fontSize: 27, lineHeight: 29, color: '#0E3A66' },
  balanceWrap: { position: 'relative', width: '100%', alignItems: 'center', marginTop: 10, marginBottom: 2 },
  balance: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 26, backgroundColor: '#FFF7D6', borderWidth: 1, borderColor: '#F1D778', gap: 8, shadowColor: '#D99A16', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  balanceStar: { fontSize: 32, color: '#F6C343', textShadowColor: '#FFF7D6', textShadowRadius: 5 },
  balanceNumber: { flexShrink: 1, fontSize: 32, lineHeight: 37, fontWeight: '800', color: '#123A63' },
  balanceLabel: { marginTop: 7, color: '#123A63', fontSize: 14, fontWeight: '600' }, balanceChevron: { marginLeft: 2, marginBottom: 2, color: '#D99A16', fontSize: 32, fontWeight: '400' },
  balanceAccent: { position: 'absolute', top: 19, width: 34, height: 32 }, balanceAccentLeft: { left: '12%' }, balanceAccentRight: { right: '12%', transform: [{ scaleX: -1 }] }, accentLine: { position: 'absolute', width: 13, height: 4, borderRadius: 3, backgroundColor: '#F6C343' }, accentLineOne: { left: 2, top: 14, transform: [{ rotate: '-12deg' }] }, accentLineTwo: { left: 11, top: 3, transform: [{ rotate: '52deg' }] }, accentLineThree: { left: 10, top: 25, transform: [{ rotate: '-50deg' }] },
  prompt: { marginTop: 16, marginBottom: 0, fontSize: 17, fontWeight: '600', color: '#123A63' },
  error: { marginTop: 10, padding: 12, backgroundColor: '#fee8e7', color: '#8a3d3a', borderRadius: 12 },
  grid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  mission: { height: 130, backgroundColor: '#0E3A66', borderRadius: 20, borderWidth: 1, borderColor: '#0B2F57', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8, shadowColor: '#0B2F57', shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  missionPressed: { transform: [{ scale: 0.95 }], backgroundColor: '#0B2F57' },
  missionBusy: { opacity: 0.68 },
  missionEmoji: { fontSize: 47, marginBottom: 5 },
  missionName: { minHeight: 28, textAlign: 'center', fontSize: 12, lineHeight: 14, fontWeight: '600', color: '#FFFFFF' },
  missionBusyText: { marginTop: 5, fontSize: 21, color: '#A9DFF7', fontWeight: '800' },
  cooldown: { marginTop: 7, alignItems: 'center', width: '80%' }, cooldownTrack: { width: '100%', height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: '#0B2F57' }, cooldownFill: { height: 4, borderRadius: 3, backgroundColor: '#76CFF5' }, cooldownText: { marginTop: 4, color: '#A9DFF7', fontSize: 10, fontWeight: '500' },
  readyPill: { marginTop: 7, minWidth: '80%', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#AEEFD7', alignItems: 'center' }, readyText: { color: '#0E3A66', fontSize: 11, fontWeight: '800' },
  rewardCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD9EA', shadowColor: '#0B2F57', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, rewardLocked: { opacity: 0.7 },
  rewardCost: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#EAF1F7', alignItems: 'center', justifyContent: 'center' }, rewardCostUnlocked: { backgroundColor: '#FFF7D6' }, rewardCostNumber: { color: '#123A63', fontSize: 22, lineHeight: 23, fontWeight: '800' }, rewardCostLabel: { color: '#123A63', fontSize: 10, fontWeight: '700' },
  rewardEmoji: { fontSize: 37 }, rewardDetails: { flex: 1, gap: 2 }, rewardTitle: { color: '#123A63', fontSize: 16, fontWeight: '700' }, rewardStatus: { color: '#607A96', fontSize: 13, fontWeight: '500' }, rewardStatusUnlocked: { color: '#0E3A66', fontWeight: '700' },
  encouragement: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 18, backgroundColor: '#C7E9FB', borderWidth: 1, borderColor: '#A9DFF7' }, encouragementText: { color: '#123A63', fontSize: 18, fontWeight: '700' }, encouragementHeart: { color: '#F6C343', fontSize: 23, textShadowColor: '#D99A16', textShadowRadius: 2 },
  empty: { marginTop: 20, padding: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#bcc9b7', borderRadius: 16 },
  celebration: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 20 },
  celebrationDim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0B2F57' },
  flyingStar: { position: 'absolute', width: 400, height: 440, alignItems: 'center', justifyContent: 'center' },
  bigStar: { fontSize: 360, color: '#F6C343', textShadowColor: '#B5780D', textShadowRadius: 22, textShadowOffset: { width: 0, height: 7 } },
  confetti: { position: 'absolute', width: 14, height: 20, borderRadius: 2 },
  confettiRound: { width: 14, height: 14, borderRadius: 7 },
  sparkle: { position: 'absolute', fontSize: 31, fontWeight: '900', textShadowColor: '#fff', textShadowRadius: 4 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' },
  sheet: { backgroundColor: '#FFFDF9', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 26, gap: 14 },
  bottomSheetRoot: { flex: 1, justifyContent: 'flex-end' }, bottomSheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0B2F5766' }, bottomSheetDismissArea: { ...StyleSheet.absoluteFillObject }, parentSheet: { width: '100%', maxWidth: 600, alignSelf: 'center', maxHeight: '84%', backgroundColor: '#FFFDF9', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#BFD9EA', borderBottomWidth: 0, overflow: 'visible', shadowColor: '#0B2F57', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }, sheetDragZone: { alignSelf: 'stretch', minHeight: 104, paddingTop: 10, paddingBottom: 14, alignItems: 'center', justifyContent: 'center', gap: 10 }, sheetHandle: { width: 48, height: 6, borderRadius: 3, backgroundColor: '#547796', opacity: 1, elevation: 2 }, parentSheetScroll: { flexShrink: 1 }, parentSheetContent: { paddingHorizontal: 18, gap: 14 },
  parentSectionTitle: { color: '#0E3A66', fontSize: 18, fontWeight: '800' }, parentHouseholdName: { color: '#123A63', fontSize: 16, fontWeight: '600' }, parentMemberLabel: { marginTop: 4, color: '#456888', fontSize: 13, fontWeight: '700' }, parentMember: { color: '#123A63', fontSize: 15 }, inviteSuccess: { padding: 12, borderRadius: 12, backgroundColor: '#E2F8EE', color: '#0E3A66', lineHeight: 20 },
  childChoice: { padding: 14, borderRadius: 16, backgroundColor: '#EAF1F7', borderWidth: 1, borderColor: '#BFD9EA', gap: 3 }, childChoiceSelected: { backgroundColor: '#FFF7D6', borderColor: '#F1D778', borderWidth: 2 }, childChoiceName: { color: '#123A63', fontSize: 17, fontWeight: '800' }, childChoiceStatus: { color: '#456888', fontSize: 13 },
  iconPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, iconChoice: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#EAF1F7', borderWidth: 1, borderColor: '#BFD9EA' }, iconChoiceSelected: { backgroundColor: '#FFF7D6', borderColor: '#F1D778', borderWidth: 2 }, iconChoiceText: { fontSize: 25 }, cooldownPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, cooldownChoice: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: '#EAF1F7', borderWidth: 1, borderColor: '#BFD9EA' }, cooldownChoiceSelected: { backgroundColor: '#AEEFD7', borderColor: '#76CFF5' }, cooldownChoiceText: { color: '#123A63', fontSize: 12, fontWeight: '700' }, manageMissionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 16, backgroundColor: '#EAF1F7' }, manageMissionIcon: { fontSize: 28 }, manageMissionDetails: { flex: 1, minWidth: 0 }, manageMissionName: { color: '#123A63', fontSize: 15, fontWeight: '800' }, manageMissionMeta: { marginTop: 2, color: '#456888', fontSize: 12 }, smallAction: { minHeight: 28, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 9, borderRadius: 14, backgroundColor: '#FFFFFF', marginVertical: 2 },
  rewardsScreen: { flex: 1, backgroundColor: '#D9F1FF' },
  rewardsHeader: { width: '100%', maxWidth: 600, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 },
  rewardsHeaderCompact: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 }, rewardsHeaderTight: { gap: 6, paddingHorizontal: 10, paddingTop: 5, paddingBottom: 6 },
  rewardsBackButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD9EA', shadowColor: '#0B2F57', shadowOpacity: 0.14, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  rewardsBackButtonTight: { width: 38, height: 38, borderRadius: 19 },
  rewardsBackIcon: { marginTop: -4, color: '#0E3A66', fontSize: 43, lineHeight: 45, fontWeight: '400' },
  rewardsBackIconTight: { fontSize: 35, lineHeight: 38 }, rewardsHeading: { flex: 1, alignItems: 'flex-start' }, rewardsScreenTitle: { color: '#0E3A66', fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 }, rewardsScreenTitleTight: { fontSize: 24, lineHeight: 28 }, rewardsScreenSubtitle: { maxWidth: 158, marginTop: 2, color: '#123A63', fontSize: 10.5, lineHeight: 14, fontWeight: '500' }, rewardsScreenSubtitleTight: { marginTop: 0, fontSize: 9, lineHeight: 11 },
  rewardsHeaderBalance: { maxWidth: '42%', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20, backgroundColor: '#FFF7D6', borderWidth: 1, borderColor: '#F1D778', shadowColor: '#D99A16', shadowOpacity: 0.16, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, rewardsHeaderBalanceStar: { color: '#F6C343', fontSize: 21, textShadowColor: '#D99A16', textShadowRadius: 2 }, rewardsHeaderBalanceNumber: { flexShrink: 1, color: '#0E3A66', fontSize: 23, lineHeight: 26, fontWeight: '900' }, rewardsHeaderBalanceLabel: { alignSelf: 'flex-end', marginBottom: 3, color: '#123A63', fontSize: 9, fontWeight: '800' },
  rewardsHeaderBalanceTight: { gap: 2, paddingHorizontal: 6, paddingVertical: 5, borderRadius: 16 }, rewardsHeaderBalanceStarTight: { fontSize: 17 }, rewardsHeaderBalanceNumberTight: { fontSize: 18, lineHeight: 21 },
  rewardsScreenContent: { width: '100%', maxWidth: 600, alignSelf: 'center', flex: 1, justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingTop: 0 },
  rewardsScreenContentCompact: { gap: 6, paddingHorizontal: 12 },
  rewardsScreenContentTight: { gap: 4, paddingHorizontal: 10 }, rewardsScrollContent: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 2 }, rewardsEmpty: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#FFFFFFAA' },
  rewardsScreenCard: { minHeight: 116, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 23, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D4E7F1', shadowColor: '#0B2F57', shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, rewardsScreenCardLocked: { backgroundColor: '#FCFEFF', borderColor: '#D4E7F1' },
  rewardsScreenCardCompact: { minHeight: 96, gap: 6, padding: 8, borderRadius: 19 }, rewardsScreenCardTight: { minHeight: 82, gap: 5, padding: 6, borderRadius: 17 },
  rewardsScreenCost: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6F3FB', borderWidth: 1, borderColor: '#D8E9F3' }, rewardsScreenCostUnlocked: { backgroundColor: '#FFF7D6', borderColor: '#F1D778' }, rewardsScreenCostNumber: { color: '#123A63', fontSize: 27, lineHeight: 29, fontWeight: '900' }, rewardsScreenCostLabel: { color: '#123A63', fontSize: 9, fontWeight: '800' },
  rewardsScreenCostCompact: { width: 48, height: 48, borderRadius: 24 }, rewardsScreenCostTight: { width: 42, height: 42, borderRadius: 21 }, rewardsScreenCostNumberTight: { fontSize: 20, lineHeight: 22 },
  rewardsScreenEmoji: { width: 50, textAlign: 'center', fontSize: 47 }, rewardsScreenDetails: { flex: 1, minWidth: 0, justifyContent: 'center', paddingRight: 1 }, rewardsScreenRewardName: { color: '#0E3A66', fontSize: 17, lineHeight: 19, fontWeight: '800' }, rewardsScreenDescription: { marginTop: 2, color: '#456888', fontSize: 11.5, lineHeight: 14, fontWeight: '500' }, rewardsRedeemButton: { alignSelf: 'flex-start', minHeight: 30, justifyContent: 'center', marginTop: 6, paddingHorizontal: 12, borderRadius: 15, backgroundColor: '#0E3A66', shadowColor: '#0B2F57', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, rewardsRedeemButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }, rewardsLockedText: { flexShrink: 1, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: '#E8F5FC', color: '#456888', fontSize: 10, fontWeight: '700' },
  rewardsScreenEmojiCompact: { width: 40, fontSize: 38 }, rewardsScreenEmojiTight: { width: 34, fontSize: 32 }, rewardsScreenRewardNameTight: { fontSize: 14, lineHeight: 16 }, rewardsScreenDescriptionTight: { marginTop: 1, fontSize: 10, lineHeight: 12 }, rewardsRedeemButtonTight: { minHeight: 24, marginTop: 4, paddingHorizontal: 8, borderRadius: 12 }, rewardsLockedTextTight: { marginTop: 4, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9 },
  keepGoingCard: { height: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 2, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#C7E9FB', borderWidth: 1, borderColor: '#A9DFF7', shadowColor: '#0B2F57', shadowOpacity: 0.06, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, keepGoingStar: { color: '#F6C343', fontSize: 48, textShadowColor: '#D99A16', textShadowRadius: 3 }, keepGoingTitle: { color: '#0E3A66', fontSize: 20, fontWeight: '800' }, keepGoingText: { marginTop: 1, color: '#123A63', fontSize: 13, fontWeight: '500' },
  keepGoingCardCompact: { height: 64, gap: 9, paddingHorizontal: 14, borderRadius: 19 }, keepGoingCardTight: { height: 54, gap: 7, paddingHorizontal: 12, borderRadius: 17 }, keepGoingStarTight: { fontSize: 34 }, keepGoingTitleTight: { fontSize: 16 }, keepGoingTextTight: { fontSize: 11 },
  rewardsSheet: { maxHeight: '88%', paddingBottom: 18, backgroundColor: '#D9F1FF' }, rewardsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, closeRewards: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD9EA' }, closeRewardsText: { color: '#0E3A66', fontSize: 27, lineHeight: 30, fontWeight: '500' },
  rewardsBalance: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24, backgroundColor: '#FFF7D6', borderWidth: 1, borderColor: '#F1D778' }, rewardsBalanceStar: { color: '#F6C343', fontSize: 30 }, rewardsBalanceNumber: { color: '#123A63', fontSize: 30, fontWeight: '800' }, rewardsBalanceLabel: { marginTop: 5, color: '#123A63', fontSize: 14, fontWeight: '600' },
  rewardsScroll: { flex: 1 }, rewardsList: { gap: 10, paddingVertical: 4 }, redeemButton: { alignSelf: 'flex-start', marginTop: 7, minHeight: 32, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#0E3A66' }, redeemButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  missionDragHandle: { width: 44, alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center' }, missionDragGlyph: { color: '#456888', fontSize: 28 }, missionRowDragging: { elevation: 8, shadowColor: '#123A63', shadowOpacity: 0.2, shadowRadius: 8 },
  manageRewardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 16, backgroundColor: '#EAF1F7' }, manageRewardRowArchived: { opacity: 0.7 }, manageRewardEmoji: { fontSize: 28 }, manageRewardDetails: { flex: 1, minWidth: 0 }, manageRewardName: { color: '#123A63', fontSize: 15, fontWeight: '800' }, manageRewardMeta: { marginTop: 2, color: '#456888', fontSize: 12 }, restoreText: { color: '#0E6B53', fontWeight: '700' },
  deleteText: { color: '#B42318', fontWeight: '700' }, deleteButton: { backgroundColor: '#B42318' },
  confirmShade: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0B2F5788' }, confirmCard: { width: '100%', maxWidth: 340, alignItems: 'center', gap: 12, padding: 24, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD9EA' }, confirmEmoji: { fontSize: 52 }, confirmTitle: { color: '#123A63', fontSize: 22, fontWeight: '800', textAlign: 'center' }, confirmError: { width: '100%', padding: 10, borderRadius: 12, backgroundColor: '#FCE6E0', color: '#963A2C', textAlign: 'center', fontSize: 13 }, confirmActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 4 }, cancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#EAF1F7' }, cancelButtonText: { color: '#123A63', fontWeight: '700' }, confirmButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#0E3A66' }, confirmButtonText: { color: '#FFFFFF', fontWeight: '800' },
  redemptionSuccess: { flex: 1, backgroundColor: '#D9F1FF', overflow: 'hidden' }, redemptionSuccessContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 28, gap: 16 }, redemptionConfetti: { position: 'absolute', width: 12, height: 25, borderRadius: 5, opacity: 0.9 },
  congratulations: { color: '#0E3A66', fontSize: 42, lineHeight: 49, fontWeight: '900', textAlign: 'center', letterSpacing: -1.1 }, redeemedSubtitle: { color: '#123A63', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  redeemedCard: { width: '100%', maxWidth: 390, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 28, borderRadius: 30, backgroundColor: '#FFF7D6', borderWidth: 4, borderColor: '#F6C343', shadowColor: '#D99A16', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 }, redeemedEmoji: { fontSize: 96, marginBottom: 8 }, redeemedName: { color: '#0E3A66', fontSize: 35, lineHeight: 41, fontWeight: '900', textAlign: 'center' }, redeemedPraise: { marginTop: 7, color: '#123A63', fontSize: 19, fontWeight: '600', textAlign: 'center' },
  redeemedStars: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 24, backgroundColor: '#A9DFF7' }, redeemedStarsIcon: { color: '#F6C343', fontSize: 31, textShadowColor: '#D99A16', textShadowRadius: 2 }, redeemedStarsText: { color: '#123A63', fontSize: 20, fontWeight: '800' },
  redeemedEncouragement: { width: '100%', maxWidth: 390, minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 20, backgroundColor: '#C7E9FB' }, redeemedEncouragementText: { color: '#123A63', fontSize: 23, fontWeight: '800' }, redeemedHeart: { color: '#F6C343', fontSize: 31, textShadowColor: '#D99A16', textShadowRadius: 2 },
  backHomeButton: { width: '100%', maxWidth: 390, minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11, borderRadius: 24, backgroundColor: '#0E3A66', shadowColor: '#0B2F57', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 }, backHomeIcon: { color: '#FFFFFF', fontSize: 34, lineHeight: 36, fontWeight: '800' }, backHomeText: { color: '#FFFFFF', fontSize: 23, fontWeight: '800' }, allRewardsButton: { width: '100%', maxWidth: 390, minHeight: 59, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 2, borderColor: '#76CFF5', borderRadius: 24, backgroundColor: '#FFFFFFCC' }, allRewardsText: { color: '#123A63', fontSize: 21, fontWeight: '800' }, allRewardsChevron: { color: '#0E3A66', fontSize: 34, lineHeight: 35 },
  sheetTitle: { fontSize: 24, fontWeight: '800', color: '#29352f' },
  secondary: { minHeight: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EEF2EC' },
  signOut: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  rewardName: { fontSize: 20, fontWeight: '800', color: '#4b3d60' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  reviewMission: { flex: 1, color: '#36433b', fontSize: 15, fontWeight: '700' },
  reviewUndo: { minHeight: 38, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 19, backgroundColor: '#edf3e9' },
  reviewUndoText: { color: '#496348', fontWeight: '800' },
})
