// src/components/ui/SolarIcon.tsx
import React from 'react';
import { useTheme } from '../../utils/themeContext';

// --- Import Duotone Icons ---
import { 
  BoxIcon as BoxIconDuo, 
  ScaleIcon as ScaleIconDuo, 
  DangerTriangleIcon as DangerTriangleIconDuo, 
  InfoCircleIcon as InfoCircleIconDuo, 
  QuestionCircleIcon as QuestionCircleIconDuo, 
  ShieldCheckIcon as ShieldCheckIconDuo, 
  ChatRoundDotsIcon as ChatRoundDotsIconDuo,
  TransferHorizontalIcon as TransferHorizontalIconDuo,
  CardIcon as CardIconDuo,
  HeadphonesRoundIcon as HeadphonesRoundIconDuo,
  SettingsIcon as SettingsIconDuo,
  MoonIcon as MoonIconDuo,
  LogoutIcon as LogoutIconDuo,
  CameraIcon as CameraIconDuo,
  GalleryIcon as GalleryIconDuo,
  PlaneIcon as PlaneIconDuo,
  PhoneIcon as PhoneIconDuo,
  MenuDotsIcon as MenuDotsIconDuo,
  AddCircleIcon as AddCircleIconDuo,
  ArrowLeftIcon as ArrowLeftIconDuo,
  MaximizeIcon as MaximizeIconDuo,
  CheckCircleIcon as CheckCircleIconDuo,
  CopyIcon as CopyIconDuo,
  MapPointIcon as MapPointIconDuo,
  RoutingIcon as RoutingIconDuo,
  StarIcon as StarIconDuo,
  PenIcon as PenIconDuo,
  CloseCircleIcon as CloseCircleIconDuo,
  MagnifierIcon as MagnifierIconDuo,
  HourglassIcon as HourglassIconDuo,
  CheckIcon as CheckIconDuo,
  LockIcon as LockIconDuo,
  KeyIcon as KeyIconDuo,
  AltArrowRightIcon as AltArrowRightIconDuo,
  AltArrowDownIcon as AltArrowDownIconDuo,
  AltArrowUpIcon as AltArrowUpIconDuo,
  BellIcon as BellIconDuo,
  BoltIcon as BoltIconDuo,
  FlagIcon as FlagIconDuo,
  CalendarIcon as CalendarIconDuo,
  ClockCircleIcon as ClockCircleIconDuo,
  RefreshIcon as RefreshIconDuo,
} from '@solar-icons/react-native/line-duotone'; 

// --- Import Linear Icons ---
import { 
  BoxIcon as BoxIconLin, 
  PhoneIcon as PhoneIconLin,
  MenuDotsIcon as MenuDotsIconLin,
  PlaneIcon as PlaneIconLin,
  CameraIcon as CameraIconLin,
  GalleryIcon as GalleryIconLin,
  AddCircleIcon as AddCircleIconLin,
  ArrowLeftIcon as ArrowLeftIconLin,
  MaximizeIcon as MaximizeIconLin,
  CheckCircleIcon as CheckCircleIconLin,
  CopyIcon as CopyIconLin,
  MapPointIcon as MapPointIconLin,
  RoutingIcon as RoutingIconLin,
  StarIcon as StarIconLin,
  PenIcon as PenIconLin,
  CloseCircleIcon as CloseCircleIconLin,
  MagnifierIcon as MagnifierIconLin,
  HourglassIcon as HourglassIconLin,
  CheckIcon as CheckIconLin,
  LockIcon as LockIconLin,
  KeyIcon as KeyIconLin,
  AltArrowRightIcon as AltArrowRightIconLin,
  AltArrowDownIcon as AltArrowDownIconLin,
  AltArrowUpIcon as AltArrowUpIconLin,
  InfoCircleIcon as InfoCircleIconLin,
  ShieldCheckIcon as ShieldCheckIconLin,
  BellIcon as BellIconLin,
  BoltIcon as BoltIconLin,
  FlagIcon as FlagIconLin,
  CalendarIcon as CalendarIconLin,
  ClockCircleIcon as ClockCircleIconLin,
  RefreshIcon as RefreshIconLin,
} from '@solar-icons/react-native/linear'; 

// --- Import Bold Icons ---
import { 
  BoxIcon as BoxIconBold, 
  PhoneIcon as PhoneIconBold,
  MenuDotsIcon as MenuDotsIconBold,
  PlaneIcon as PlaneIconBold,
  CameraIcon as CameraIconBold,
  GalleryIcon as GalleryIconBold,
  AddCircleIcon as AddCircleIconBold,
  ArrowLeftIcon as ArrowLeftIconBold,
  MaximizeIcon as MaximizeIconBold,
  CheckCircleIcon as CheckCircleIconBold,
  CopyIcon as CopyIconBold,
  MapPointIcon as MapPointIconBold,
  RoutingIcon as RoutingIconBold,
  StarIcon as StarIconBold,
  PenIcon as PenIconBold,
  CloseCircleIcon as CloseCircleIconBold,
  MagnifierIcon as MagnifierIconBold,
  HourglassIcon as HourglassIconBold,
  CheckIcon as CheckIconBold,
  LockIcon as LockIconBold,
  KeyIcon as KeyIconBold,
  AltArrowRightIcon as AltArrowRightIconBold,
  AltArrowDownIcon as AltArrowDownIconBold,
  AltArrowUpIcon as AltArrowUpIconBold,
  SettingsIcon as SettingsIconBold,
  BellIcon as BellIconBold,
  BoltIcon as BoltIconBold,
  FlagIcon as FlagIconBold,
  CalendarIcon as CalendarIconBold,
  ClockCircleIcon as ClockCircleIconBold,
  RefreshIcon as RefreshIconBold,
  ScaleIcon as ScaleIconBold,
  DangerTriangleIcon as DangerTriangleIconBold,
  InfoCircleIcon as InfoCircleIconBold,
  QuestionCircleIcon as QuestionCircleIconBold,
  ShieldCheckIcon as ShieldCheckIconBold,
  ChatRoundDotsIcon as ChatRoundDotsIconBold,
  TransferHorizontalIcon as TransferHorizontalIconBold,
  CardIcon as CardIconBold,
  HeadphonesRoundIcon as HeadphonesRoundIconBold,
  MoonIcon as MoonIconBold,
  LogoutIcon as LogoutIconBold,
} from '@solar-icons/react-native/bold'; 

// --- Import Bold Duotone Icons ---
import { 
  BoxIcon as BoxIconBoldDuo, 
  PhoneIcon as PhoneIconBoldDuo,
  MenuDotsIcon as MenuDotsIconBoldDuo,
  PlaneIcon as PlaneIconBoldDuo,
  CameraIcon as CameraIconBoldDuo,
  GalleryIcon as GalleryIconBoldDuo,
  AddCircleIcon as AddCircleIconBoldDuo,
  ArrowLeftIcon as ArrowLeftIconBoldDuo,
  MaximizeIcon as MaximizeIconBoldDuo,
  CheckCircleIcon as CheckCircleIconBoldDuo,
  CopyIcon as CopyIconBoldDuo,
  MapPointIcon as MapPointIconBoldDuo,
  RoutingIcon as RoutingIconBoldDuo,
  StarIcon as StarIconBoldDuo,
  PenIcon as PenIconBoldDuo,
  CloseCircleIcon as CloseCircleIconBoldDuo,
  MagnifierIcon as MagnifierIconBoldDuo,
  HourglassIcon as HourglassIconBoldDuo,
  CheckIcon as CheckIconBoldDuo,
  LockIcon as LockIconBoldDuo,
  KeyIcon as KeyIconBoldDuo,
  AltArrowRightIcon as AltArrowRightIconBoldDuo,
  AltArrowDownIcon as AltArrowDownIconBoldDuo,
  AltArrowUpIcon as AltArrowUpIconBoldDuo,
  SettingsIcon as SettingsIconBoldDuo,
  BellIcon as BellIconBoldDuo,
  BoltIcon as BoltIconBoldDuo,
  FlagIcon as FlagIconBoldDuo,
  CalendarIcon as CalendarIconBoldDuo,
  ClockCircleIcon as ClockCircleIconBoldDuo,
  RefreshIcon as RefreshIconBoldDuo,
  ScaleIcon as ScaleIconBoldDuo,
  DangerTriangleIcon as DangerTriangleIconBoldDuo,
  InfoCircleIcon as InfoCircleIconBoldDuo,
  QuestionCircleIcon as QuestionCircleIconBoldDuo,
  ShieldCheckIcon as ShieldCheckIconBoldDuo,
  ChatRoundDotsIcon as ChatRoundDotsIconBoldDuo,
  TransferHorizontalIcon as TransferHorizontalIconBoldDuo,
  CardIcon as CardIconBoldDuo,
  HeadphonesRoundIcon as HeadphonesRoundIconBoldDuo,
  MoonIcon as MoonIconBoldDuo,
  LogoutIcon as LogoutIconBoldDuo,
} from '@solar-icons/react-native/bold-duotone'; 

const LINEAR_MAP = {
  Package: BoxIconLin,
  Camera: CameraIconLin,
  Gallery: GalleryIconLin,
  PaperPlane: PlaneIconLin,
  Phone: PhoneIconLin,
  MenuDots: MenuDotsIconLin,
  AddCircle: AddCircleIconLin,
  ArrowLeft: ArrowLeftIconLin,
  Maximize: MaximizeIconLin,
  CheckCircle: CheckCircleIconLin,
  Copy: CopyIconLin,
  MapPoint: MapPointIconLin,
  Routing: RoutingIconLin,
  Star: StarIconLin,
  Pen: PenIconLin,
  CloseCircle: CloseCircleIconLin,
  Magnifier: MagnifierIconLin,
  Hourglass: HourglassIconLin,
  Check: CheckIconLin,
  Lock: LockIconLin,
  Key: KeyIconLin,
  AltArrowRight: AltArrowRightIconLin,
  AltArrowDown: AltArrowDownIconLin,
  AltArrowUp: AltArrowUpIconLin,
  InfoCircle: InfoCircleIconLin,
  ShieldCheck: ShieldCheckIconLin,
  Bell: BellIconLin,
  Lightning: BoltIconLin,
  Flag: FlagIconLin,
  Calendar: CalendarIconLin,
  Clock: ClockCircleIconLin,
  Refresh: RefreshIconLin,
  // Fallbacks
  Scales: ScaleIconDuo,
  Warning: DangerTriangleIconDuo,
  Info: InfoCircleIconDuo,
  Question: QuestionCircleIconDuo,
  ChatCircleText: ChatRoundDotsIconDuo,
  TransferHorizontal: TransferHorizontalIconDuo,
  Card: CardIconDuo,
  HeadphonesRound: HeadphonesRoundIconDuo,
  Settings: SettingsIconDuo,
  Moon: MoonIconDuo,
  Logout: LogoutIconDuo,
} as const;

const DUOTONE_MAP = {
  Package: BoxIconDuo,
  Scales: ScaleIconDuo,
  Warning: DangerTriangleIconDuo,
  Info: InfoCircleIconDuo,
  Question: QuestionCircleIconDuo,
  ShieldCheck: ShieldCheckIconDuo,
  ChatCircleText: ChatRoundDotsIconDuo,
  TransferHorizontal: TransferHorizontalIconDuo,
  Card: CardIconDuo,
  HeadphonesRound: HeadphonesRoundIconDuo,
  Settings: SettingsIconDuo,
  Moon: MoonIconDuo,
  Logout: LogoutIconDuo,
  Camera: CameraIconDuo,
  Gallery: GalleryIconDuo,
  PaperPlane: PlaneIconDuo,
  Phone: PhoneIconDuo,
  MenuDots: MenuDotsIconDuo,
  AddCircle: AddCircleIconDuo,
  ArrowLeft: ArrowLeftIconDuo,
  Maximize: MaximizeIconDuo,
  CheckCircle: CheckCircleIconDuo,
  Copy: CopyIconDuo,
  MapPoint: MapPointIconDuo,
  Routing: RoutingIconDuo,
  Star: StarIconDuo,
  Pen: PenIconDuo,
  CloseCircle: CloseCircleIconDuo,
  Magnifier: MagnifierIconDuo,
  Hourglass: HourglassIconDuo,
  Check: CheckIconDuo,
  Lock: LockIconDuo,
  Key: KeyIconDuo,
  AltArrowRight: AltArrowRightIconDuo,
  AltArrowDown: AltArrowDownIconDuo,
  AltArrowUp: AltArrowUpIconDuo,
  Bell: BellIconDuo,
  Lightning: BoltIconDuo,
  Flag: FlagIconDuo,
  Calendar: CalendarIconDuo,
  Clock: ClockCircleIconDuo,
  Refresh: RefreshIconDuo,
} as const;

const BOLD_MAP = {
  Package: BoxIconBold,
  Scales: ScaleIconBold,
  Warning: DangerTriangleIconBold,
  Info: InfoCircleIconBold,
  Question: QuestionCircleIconBold,
  ShieldCheck: ShieldCheckIconBold,
  ChatCircleText: ChatRoundDotsIconBold,
  TransferHorizontal: TransferHorizontalIconBold,
  Card: CardIconBold,
  HeadphonesRound: HeadphonesRoundIconBold,
  Settings: SettingsIconBold,
  Moon: MoonIconBold,
  Logout: LogoutIconBold,
  Camera: CameraIconBold,
  Gallery: GalleryIconBold,
  PaperPlane: PlaneIconBold,
  Phone: PhoneIconBold,
  MenuDots: MenuDotsIconBold,
  AddCircle: AddCircleIconBold,
  ArrowLeft: ArrowLeftIconBold,
  Maximize: MaximizeIconBold,
  CheckCircle: CheckCircleIconBold,
  Copy: CopyIconBold,
  MapPoint: MapPointIconBold,
  Routing: RoutingIconBold,
  Star: StarIconBold,
  Pen: PenIconBold,
  CloseCircle: CloseCircleIconBold,
  Magnifier: MagnifierIconBold,
  Hourglass: HourglassIconBold,
  Check: CheckIconBold,
  Lock: LockIconBold,
  Key: KeyIconBold,
  AltArrowRight: AltArrowRightIconBold,
  AltArrowDown: AltArrowDownIconBold,
  AltArrowUp: AltArrowUpIconBold,
  Bell: BellIconBold,
  Lightning: BoltIconBold,
  Flag: FlagIconBold,
  Calendar: CalendarIconBold,
  Clock: ClockCircleIconBold,
  Refresh: RefreshIconBold,
} as const;

const BOLD_DUOTONE_MAP = {
  Package: BoxIconBoldDuo,
  Scales: ScaleIconBoldDuo,
  Warning: DangerTriangleIconBoldDuo,
  Info: InfoCircleIconBoldDuo,
  Question: QuestionCircleIconBoldDuo,
  ShieldCheck: ShieldCheckIconBoldDuo,
  ChatCircleText: ChatRoundDotsIconBoldDuo,
  TransferHorizontal: TransferHorizontalIconBoldDuo,
  Card: CardIconBoldDuo,
  HeadphonesRound: HeadphonesRoundIconBoldDuo,
  Settings: SettingsIconBoldDuo,
  Moon: MoonIconBoldDuo,
  Logout: LogoutIconBoldDuo,
  Camera: CameraIconBoldDuo,
  Gallery: GalleryIconBoldDuo,
  PaperPlane: PlaneIconBoldDuo,
  Phone: PhoneIconBoldDuo,
  MenuDots: MenuDotsIconBoldDuo,
  AddCircle: AddCircleIconBoldDuo,
  ArrowLeft: ArrowLeftIconBoldDuo,
  Maximize: MaximizeIconBoldDuo,
  CheckCircle: CheckCircleIconBoldDuo,
  Copy: CopyIconBoldDuo,
  MapPoint: MapPointIconBoldDuo,
  Routing: RoutingIconBoldDuo,
  Star: StarIconBoldDuo,
  Pen: PenIconBoldDuo,
  CloseCircle: CloseCircleIconBoldDuo,
  Magnifier: MagnifierIconBoldDuo,
  Hourglass: HourglassIconBoldDuo,
  Check: CheckIconBoldDuo,
  Lock: LockIconBoldDuo,
  Key: KeyIconBoldDuo,
  AltArrowRight: AltArrowRightIconBoldDuo,
  AltArrowDown: AltArrowDownIconBoldDuo,
  AltArrowUp: AltArrowUpIconBoldDuo,
  Bell: BellIconBoldDuo,
  Lightning: BoltIconBoldDuo,
  Flag: FlagIconBoldDuo,
  Calendar: CalendarIconBoldDuo,
  Clock: ClockCircleIconBoldDuo,
  Refresh: RefreshIconBoldDuo,
} as const;

export type SolarIconName = keyof typeof DUOTONE_MAP;
export type SolarIconVariant = 'linear' | 'duotone' | 'bold' | 'boldDuotone';

// Icons that natively render with swapped colors in the library
const INVERTED_ICONS = new Set([
  'Scales',
  'Warning',
  'ShieldCheck',
  'HeadphonesRound',
  'Settings',
  'AddCircle', 
  'Camera',    
  'Moon',              
  'Logout',            
  'TransferHorizontal', 
  'MapPoint',
  'Routing',
]);

interface SolarIconProps {
  name: SolarIconName;
  size?: number;
  color?: string;          
  secondaryColor?: string; 
  variant?: SolarIconVariant; 
}

export const SolarIcon = ({ 
  name, 
  size = 24, 
  color, 
  secondaryColor,
  variant = 'duotone' 
}: SolarIconProps) => {
  const { colors, isDark } = useTheme();
  
  // 1. Select the correct map based on the variant
  let IconComponent: any = null;
  switch (variant) {
    case 'linear': IconComponent = LINEAR_MAP[name]; break;
    case 'bold': IconComponent = BOLD_MAP[name]; break;
    case 'boldDuotone': IconComponent = BOLD_DUOTONE_MAP[name]; break;
    default: IconComponent = DUOTONE_MAP[name]; break;
  }

  if (!IconComponent) {
    console.warn(`[SolarIcon] Icon "${name}" not found for variant "${variant}".`);
    return null;
  }

  // 2. Smart Theme Logic
  const defaultOutline = isDark ? colors.accent : colors.textPrimary;
  const defaultFill = isDark ? '#FFFFFF' : colors.accent;

  const outlineColor = color || defaultOutline;
  const fillColor = secondaryColor || defaultFill;

  const isInverted = INVERTED_ICONS.has(name);
  
  // 3. Render Logic
  // Linear and Bold only use the outline color
  if (variant === 'linear' || variant === 'bold') {
    return (
      <IconComponent
        size={size}
        color={isInverted ? fillColor : outlineColor} 
      />
    );
  }

  // Duotone and BoldDuotone use both colors
  return (
    <IconComponent
      size={size}
      color={isInverted ? fillColor : outlineColor} 
      secondaryColor={isInverted ? outlineColor : fillColor} 
      secondaryOpacity={1} 
    />
  );
};