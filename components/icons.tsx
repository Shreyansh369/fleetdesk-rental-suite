import type {
  ComponentType,
} from "react";

import type {
  Icon as PhosphorIcon,
  IconProps,
  IconWeight,
} from "@phosphor-icons/react";

import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  CalendarIcon,
  CalendarMinusIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CameraIcon,
  CarIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  CookieIcon,
  CopyIcon,
  CreditCardIcon,
  CurrencyCircleDollarIcon,
  DatabaseIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EraserIcon,
  FileTextIcon,
  FileXIcon,
  FlaskIcon,
  GaugeIcon,
  GlobeIcon,
  HandCoinsIcon,
  HourglassIcon,
  ImageBrokenIcon,
  ImageSquareIcon,
  InfoIcon,
  KeyIcon,
  ListIcon,
  LockIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  ScalesIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  SignOutIcon,
  SignatureIcon,
  SparkleIcon,
  SquaresFourIcon,
  TelevisionIcon,
  TrashIcon,
  UserCheckIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
  WalletIcon,
  WarningIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";

/*
 * The application's icon set, in one place. Screens import icons
 * from here by the names they have always used, and this file
 * decides how they are drawn: Phosphor, in one weight, decorative
 * by default. Changing the set, or its weight, is a change here
 * and nowhere else.
 *
 * `strokeWidth` is accepted for compatibility with the props the
 * screens already pass; a heavier stroke asks for the bold weight.
 */

export type AppIconProps = Omit<IconProps, "weight"> & {
  weight?: IconWeight;
  strokeWidth?: number;
};

export type AppIcon = ComponentType<AppIconProps>;

/* Kept so existing `type LucideIcon` annotations keep compiling. */
export type LucideIcon = AppIcon;

function icon(
  Base: PhosphorIcon,
  name: string,
): AppIcon {
  function Drawn({
    strokeWidth,
    weight,
    ...props
  }: AppIconProps) {
    return (
      <Base
        aria-hidden={
          props["aria-label"] ? undefined : true
        }
        weight={
          weight ??
          (strokeWidth && strokeWidth >= 2.4
            ? "bold"
            : "regular")
        }
        {...props}
      />
    );
  }

  Drawn.displayName = name;

  return Drawn;
}

export const AlertTriangle = icon(WarningIcon, "AlertTriangle");
export const ArrowRight = icon(ArrowRightIcon, "ArrowRight");
export const ArrowUpDown = icon(ArrowsDownUpIcon, "ArrowUpDown");
export const BadgeCheck = icon(SealCheckIcon, "BadgeCheck");
export const BarChart3 = icon(ChartBarIcon, "BarChart3");
export const Building2 = icon(BuildingsIcon, "Building2");
export const CalendarArrowDown = icon(CalendarMinusIcon, "CalendarArrowDown");
export const CalendarArrowUp = icon(CalendarPlusIcon, "CalendarArrowUp");
export const CalendarCheck2 = icon(CalendarCheckIcon, "CalendarCheck2");
export const CalendarClock = icon(CalendarDotsIcon, "CalendarClock");
export const CalendarDays = icon(CalendarIcon, "CalendarDays");
export const Camera = icon(CameraIcon, "Camera");
export const CarFront = icon(CarIcon, "CarFront");
export const Check = icon(CheckIcon, "Check");
export const CheckCircle2 = icon(CheckCircleIcon, "CheckCircle2");
export const ChevronDown = icon(CaretDownIcon, "ChevronDown");
export const ChevronRight = icon(CaretRightIcon, "ChevronRight");
export const CircleDollarSign = icon(CurrencyCircleDollarIcon, "CircleDollarSign");
export const ClipboardCheck = icon(ClipboardTextIcon, "ClipboardCheck");
export const ClipboardCopy = icon(CopyIcon, "ClipboardCopy");
export const Clock3 = icon(ClockIcon, "Clock3");
export const Copy = icon(CopyIcon, "Copy");
export const CreditCard = icon(CreditCardIcon, "CreditCard");
export const Download = icon(DownloadSimpleIcon, "Download");
export const Eraser = icon(EraserIcon, "Eraser");
export const FileSignature = icon(SignatureIcon, "FileSignature");
export const FileText = icon(FileTextIcon, "FileText");
export const FileWarning = icon(FileXIcon, "FileWarning");
export const FlaskConical = icon(FlaskIcon, "FlaskConical");
export const HandCoins = icon(HandCoinsIcon, "HandCoins");
export const History = icon(ClockCounterClockwiseIcon, "History");
export const Hourglass = icon(HourglassIcon, "Hourglass");
export const ImageOff = icon(ImageBrokenIcon, "ImageOff");
export const ImagePlus = icon(ImageSquareIcon, "ImagePlus");
export const LayoutDashboard = icon(SquaresFourIcon, "LayoutDashboard");
export const LoaderCircle = icon(CircleNotchIcon, "LoaderCircle");
export const LogOut = icon(SignOutIcon, "LogOut");
export const Mail = icon(EnvelopeSimpleIcon, "Mail");
export const Menu = icon(ListIcon, "Menu");
export const Pencil = icon(PencilSimpleIcon, "Pencil");
export const Plus = icon(PlusIcon, "Plus");
export const PlusCircle = icon(PlusCircleIcon, "PlusCircle");
export const Printer = icon(PrinterIcon, "Printer");
export const ReceiptText = icon(ReceiptIcon, "ReceiptText");
export const RefreshCw = icon(ArrowsClockwiseIcon, "RefreshCw");
export const RotateCcw = icon(ArrowCounterClockwiseIcon, "RotateCcw");
export const Search = icon(MagnifyingGlassIcon, "Search");
export const Send = icon(PaperPlaneTiltIcon, "Send");
export const ShieldAlert = icon(ShieldWarningIcon, "ShieldAlert");
export const ShieldCheck = icon(ShieldCheckIcon, "ShieldCheck");
export const Sparkles = icon(SparkleIcon, "Sparkles");
export const Trash2 = icon(TrashIcon, "Trash2");
export const Undo2 = icon(ArrowUUpLeftIcon, "Undo2");
export const UserPlus = icon(UserPlusIcon, "UserPlus");
export const UserRound = icon(UserIcon, "UserRound");
export const UserRoundCheck = icon(UserCheckIcon, "UserRoundCheck");
export const UserRoundX = icon(UserMinusIcon, "UserRoundX");
export const UsersRound = icon(UsersIcon, "UsersRound");
export const WalletCards = icon(WalletIcon, "WalletCards");
export const Wrench = icon(WrenchIcon, "Wrench");
export const X = icon(XIcon, "X");
export const XCircle = icon(XCircleIcon, "XCircle");
export const Cookie = icon(CookieIcon, "Cookie");
export const Scales = icon(ScalesIcon, "Scales");
export const DeviceMobile = icon(DeviceMobileIcon, "DeviceMobile");
export const Globe = icon(GlobeIcon, "Globe");
export const Database = icon(DatabaseIcon, "Database");
export const Lock = icon(LockIcon, "Lock");
export const Info = icon(InfoIcon, "Info");
export const Gauge = icon(GaugeIcon, "Gauge");
export const Television = icon(TelevisionIcon, "Television");
export const Desktop = icon(DesktopIcon, "Desktop");
export const CalendarX = icon(CalendarXIcon, "CalendarX");
export const Key = icon(KeyIcon, "Key");
export const ArrowLeft = icon(ArrowLeftIcon, "ArrowLeft");
export const Users = icon(UsersThreeIcon, "Users");
