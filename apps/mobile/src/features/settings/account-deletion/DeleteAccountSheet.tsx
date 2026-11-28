import { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../../strings';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { TextField } from '../../../ui/inputs/TextField';
import { BottomSheet } from '../../../ui/layout/BottomSheet';
import { Text } from '../../../ui/typography/typography';
import { emailConfirms } from './email-confirmation';
import { useDeleteAccount } from './use-delete-account';

type Props = {
  visible: boolean;
  // The address of the account, from the session on the device. Null matches nothing.
  email: string | null;
  onClose: () => void;
};

// The confirmation of account deletion (design frame 4b·2). «Удалить навсегда» works only
// while the typed address matches. While the request is out nothing in the sheet reacts and
// it cannot be closed, so the person sees how it ends. A failure is a line in the sheet, not
// a toast, which would be drawn under the Modal. After a success the sign-out removes this
// screen, so there is no success state.
export function DeleteAccountSheet({ visible, email, onClose }: Props) {
  const copy = strings.settings.deleteSheet;
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  // The mutation state reaches the screen one render late: two quick taps would both see
  // "not pending". This is set in the tap itself and cleared only by a failure.
  const sendingRef = useRef(false);
  // Success counts too: the button must not come back while the screen is being removed.
  const pending = remove.isPending || remove.isSuccess;
  const matches = emailConfirms(typed, email);
  const disabled = !matches || pending;

  const confirm = () => {
    if (sendingRef.current || !matches) return;
    sendingRef.current = true;
    Keyboard.dismiss();
    remove.mutate(undefined, {
      onError: () => {
        sendingRef.current = false;
      },
    });
  };

  const edit = (value: string) => {
    if (sendingRef.current) return;
    setTyped(value);
    if (remove.isError) remove.reset();
  };

  const close = () => {
    if (sendingRef.current) return;
    Keyboard.dismiss();
    setTyped('');
    remove.reset();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} dismissible={!pending} avoidKeyboard>
      <View style={styles.content}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>
          {strings.settings.dangerText} {copy.confirmLead} <Text style={styles.email}>{email}</Text>
          .
        </Text>
        {/* The hints keep autofill and suggestions out: the person is meant to type it. The
            keyboard's Done key only closes the keyboard: there is no submit handler. */}
        <TextField
          label={copy.emailField}
          placeholder={copy.emailField}
          value={typed}
          onChangeText={edit}
          editable={!pending}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          returnKeyType="done"
        />
        {remove.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {copy.failed}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: pending }}
          disabled={disabled}
          onPress={confirm}
          style={({ pressed }) => [
            styles.destructive,
            !matches && !pending && styles.inactive,
            pressed && styles.pressed,
          ]}
        >
          {pending ? <ActivityIndicator size="small" color={colors.dangerZoneText} /> : null}
          <Text style={styles.destructiveLabel}>{pending ? copy.pending : copy.confirm}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending }}
          disabled={pending}
          onPress={close}
          style={({ pressed }) => [
            styles.cancel,
            pending && styles.inactive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.cancelLabel}>{copy.cancel}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingTop: spacing.sm },
  title: { color: colors.dangerZoneText, fontSize: 19, fontWeight: '500' },
  body: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22 },
  email: { color: colors.text, fontWeight: '600' },
  error: { color: colors.danger, fontSize: typeSizes.small, lineHeight: 20 },
  destructive: {
    // A minimum, so a large system font makes the button taller instead of being cut.
    minHeight: 52,
    marginTop: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.dangerZoneButtonOutline,
    backgroundColor: colors.dangerZoneButtonTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  destructiveLabel: {
    color: colors.dangerZoneText,
    fontSize: typeSizes.bodyLarge,
    fontWeight: '500',
  },
  cancel: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { color: colors.textSoft, fontSize: typeSizes.bodyLarge },
  inactive: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
