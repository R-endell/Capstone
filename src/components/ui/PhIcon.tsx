// src/components/ui/PhIcon.tsx
import React from 'react';
import { SvgProps } from 'react-native-svg';
import { useTheme } from '../../utils/themeContext';

// Import SVGs directly from your new assets folder.
const ICON_MAP = {
  regular: {
    ArrowLeft: require('../../../assets/icons/phosphor/regular/ArrowLeft.svg').default,
    ArrowsClockwise: require('../../../assets/icons/phosphor/regular/ArrowsClockwise.svg').default,
    ArrowsLeftRight: require('../../../assets/icons/phosphor/regular/ArrowsLeftRight.svg').default,
    Bell: require('../../../assets/icons/phosphor/regular/Bell.svg').default,
    CaretDown: require('../../../assets/icons/phosphor/regular/CaretDown.svg').default,
    CaretLeft: require('../../../assets/icons/phosphor/regular/CaretLeft.svg').default,
    CaretRight: require('../../../assets/icons/phosphor/regular/CaretRight.svg').default,
    CaretUp: require('../../../assets/icons/phosphor/regular/CaretUp.svg').default,
    ChartBar: require('../../../assets/icons/phosphor/regular/ChartBar.svg').default,
    ChatCircleDots: require('../../../assets/icons/phosphor/regular/ChatCircleDots.svg').default,
    ChatCircleText: require('../../../assets/icons/phosphor/regular/ChatCircleText.svg').default,
    CheckCircle: require('../../../assets/icons/phosphor/regular/CheckCircle.svg').default,
    ClipboardText: require('../../../assets/icons/phosphor/regular/ClipboardText.svg').default,
    Clock: require('../../../assets/icons/phosphor/regular/Clock.svg').default,
    Compass: require('../../../assets/icons/phosphor/regular/Compass.svg').default,
    CreditCard: require('../../../assets/icons/phosphor/regular/CreditCard.svg').default,
    EnvelopeSimple: require('../../../assets/icons/phosphor/regular/EnvelopeSimple.svg').default,
    Eye: require('../../../assets/icons/phosphor/regular/Eye.svg').default,
    EyeSlash: require('../../../assets/icons/phosphor/regular/EyeSlash.svg').default,
    FileText: require('../../../assets/icons/phosphor/regular/FileText.svg').default,
    Gear: require('../../../assets/icons/phosphor/regular/Gear.svg').default,
    Headset: require('../../../assets/icons/phosphor/regular/Headset..svg').default, // Double dot handled
    House: require('../../../assets/icons/phosphor/regular/House.svg').default,
    Keypad: require('../../../assets/icons/phosphor/regular/Keypad.svg').default,
    Lightning: require('../../../assets/icons/phosphor/regular/Lightning.svg').default,
    LockSimple: require('../../../assets/icons/phosphor/regular/LockSimple.svg').default,
    MapPinLine: require('../../../assets/icons/phosphor/regular/MapPinLine.svg').default,
    MapTrifold: require('../../../assets/icons/phosphor/regular/MapTrifold..svg').default, // Double dot handled
    Minus: require('../../../assets/icons/phosphor/regular/Minus.svg').default,
    Moon: require('../../../assets/icons/phosphor/regular/Moon.svg').default,
    NavigationArrow: require('../../../assets/icons/phosphor/regular/NavigationArrow.svg').default,
    Package: require('../../../assets/icons/phosphor/regular/Package.svg').default,
    PaperPlaneTilt: require('../../../assets/icons/phosphor/regular/PaperPlaneTilt.svg').default,
    PencilSimple: require('../../../assets/icons/phosphor/regular/PencilSimple.svg').default,
    Plus: require('../../../assets/icons/phosphor/regular/Plus.svg').default,
    Scales: require('../../../assets/icons/phosphor/regular/Scales.svg').default,
    ShieldCheck: require('../../../assets/icons/phosphor/regular/ShieldCheck.svg').default,
    ShieldWarning: require('../../../assets/icons/phosphor/regular/ShieldWarning.svg').default,
    SignOut: require('../../../assets/icons/phosphor/regular/SignOut.svg').default,
    SpeakerHigh: require('../../../assets/icons/phosphor/regular/SpeakerHigh.svg').default,
    SpeakerSimpleSlash: require('../../../assets/icons/phosphor/regular/SpeakerSimpleSlash.svg').default,
    Sun: require('../../../assets/icons/phosphor/regular/Sun.svg').default,
    Trash: require('../../../assets/icons/phosphor/regular/Trash.svg').default,
    User: require('../../../assets/icons/phosphor/regular/User.svg').default,
    UserCircle: require('../../../assets/icons/phosphor/regular/UserCircle.svg').default,
    Warning: require('../../../assets/icons/phosphor/regular/Warning.svg').default,
    WarningCircle: require('../../../assets/icons/phosphor/regular/WarningCircle.svg').default,
    X: require('../../../assets/icons/phosphor/regular/X.svg').default,
    XCircle: require('../../../assets/icons/phosphor/regular/XCircle.svg').default,
  },
  fill: {
    ChartBar: require('../../../assets/icons/phosphor/fill/ChartBar.svg').default,
    ChatCircleDots: require('../../../assets/icons/phosphor/fill/ChatCircleDots.svg').default,
    CheckCircle: require('../../../assets/icons/phosphor/fill/CheckCircle.svg').default,
    ClipboardText: require('../../../assets/icons/phosphor/fill/ClipboardText.svg').default,
    Clock: require('../../../assets/icons/phosphor/fill/Clock.svg').default,
    Compass: require('../../../assets/icons/phosphor/fill/Compass.svg').default,
    Flag: require('../../../assets/icons/phosphor/fill/Flag.svg').default,
    Headset: require('../../../assets/icons/phosphor/fill/Headset.svg').default,
    House: require('../../../assets/icons/phosphor/fill/House.svg').default,
    MapPin: require('../../../assets/icons/phosphor/fill/MapPin.svg').default,
    MapTrifold: require('../../../assets/icons/phosphor/fill/MapTrifold..svg').default, // Double dot handled
    Microphone: require('../../../assets/icons/phosphor/fill/Microphone.svg').default,
    MicrophoneSlash: require('../../../assets/icons/phosphor/fill/MicrophoneSlash.svg').default,
    Moon: require('../../../assets/icons/phosphor/fill/Moon.svg').default,
    NavigationArrow: require('../../../assets/icons/phosphor/fill/NavigationArrow.svg').default,
    Package: require('../../../assets/icons/phosphor/fill/Package.svg').default,
    PaperPlaneTilt: require('../../../assets/icons/phosphor/fill/PaperPlaneTilt.svg').default,
    PhoneCall: require('../../../assets/icons/phosphor/fill/PhoneCall.svg').default,
    PhoneDisconnect: require('../../../assets/icons/phosphor/fill/PhoneDisconnect.svg').default,
    SealCheck: require('../../../assets/icons/phosphor/fill/SealCheck.svg').default,
    ShieldCheck: require('../../../assets/icons/phosphor/fill/ShieldCheck.svg').default,
    User: require('../../../assets/icons/phosphor/fill/User.svg').default,
    UserCircle: require('../../../assets/icons/phosphor/fill/UserCircle.svg').default,
    WarningCircle: require('../../../assets/icons/phosphor/fill/WarningCircle.svg').default,
  },
  bold: {
    ArrowLeft: require('../../../assets/icons/phosphor/bold/ArrowLeft.svg').default,
    ArrowRight: require('../../../assets/icons/phosphor/bold/ArrowRight.svg').default,
    ArrowsClockwise: require('../../../assets/icons/phosphor/bold/ArrowsClockwise.svg').default,
    ArrowUp: require('../../../assets/icons/phosphor/bold/ArrowUp.svg').default,
    ArrowUUpLeft: require('../../../assets/icons/phosphor/bold/ArrowUUpLeft.svg').default,
    GitMerge: require('../../../assets/icons/phosphor/bold/GitMerge.svg').default,
  }
} as const;

export type PhIconWeight = 'regular' | 'fill' | 'bold';
export type PhIconName = keyof typeof ICON_MAP['regular'];

interface PhIconProps extends Omit<SvgProps, 'width' | 'height'> {
  name: PhIconName;
  weight?: PhIconWeight;
  size?: number;
  color?: string; // Accepts theme colors, defaults to textPrimary
}

export const PhIcon = ({ 
  name, 
  weight = 'regular', 
  size = 24, 
  color,
  style,
  ...props 
}: PhIconProps) => {
  const { colors } = useTheme();
  
  // Fallback safely if a specific weight doesn't have the icon mapped
  const IconComponent = (ICON_MAP[weight] as any)[name] || (ICON_MAP.regular as any)[name];
  
  if (!IconComponent) {
    console.warn(`[PhIcon] Icon "${name}" not found in "${weight}" or "regular" weight.`);
    return null;
  }

  return (
    <IconComponent 
      width={size} 
      height={size} 
      color={color || colors.textPrimary} 
      fill={color || colors.textPrimary} // Force fill to override hardcoded black
      style={[{ color: color || colors.textPrimary }, style]} // Force style color
      {...props} 
    />
  );
};