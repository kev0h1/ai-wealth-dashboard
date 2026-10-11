// A138: what Settings tells the user when a test push finds no registered
// device. On native there is no notifications toggle to flip (the OS
// permission is the switch), so the old "turn off and on again" advice was
// impossible; native gets a "Register this device" action instead.
export interface NoDeviceAdvice {
  text: string;
  action: string | null;
}

export const REGISTER_DEVICE_LABEL = "Register this device";

export function noDeviceAdvice(native: boolean): NoDeviceAdvice {
  if (native) {
    return {
      text: "This device isn't registered for notifications yet.",
      action: REGISTER_DEVICE_LABEL,
    };
  }
  return {
    text: "No device is registered yet. Turn notifications off and on again to register this device.",
    action: null,
  };
}
