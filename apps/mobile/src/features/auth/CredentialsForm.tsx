import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View, type TextInput } from 'react-native';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { BackButton } from '../../ui/BackButton';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { PromptLink } from '../../ui/PromptLink';
import { Screen } from '../../ui/Screen';
import { TextField } from '../../ui/TextField';
import { TextLink } from '../../ui/TextLink';
import { authErrorMessage, classifyAuthError, type AuthErrorKind } from './auth-errors';
import { SignInFormSchema, SignUpFormSchema, type CredentialsFormValues } from './forms';
import { supabase } from './supabase';

type Props = { mode: 'signUp' | 'signIn' };

// Nothing on this screen navigates after success. A signed-in session fires
// onAuthStateChange, the session store flips, and the gate in the root layout swaps the
// route group (onboarding or Home, depending on /me).
async function submitCredentials(
  mode: Props['mode'],
  email: string,
  password: string,
): Promise<{ message: string; kind: AuthErrorKind | 'confirmationRequired' } | null> {
  try {
    if (mode === 'signIn') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const kind = classifyAuthError(error);
        return { kind, message: authErrorMessage(kind) };
      }
      return null;
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      const kind = classifyAuthError(error);
      return { kind, message: authErrorMessage(kind) };
    }
    if (data.session) return null;
    // No session and no error. With "confirm email" ON, GoTrue answers an existing address
    // with an obfuscated user whose `identities` list is empty; a genuinely new address gets
    // a user and must confirm by mail first. Either way the user must not be left hanging.
    if (data.user && data.user.identities?.length === 0) {
      return { kind: 'userAlreadyExists', message: authErrorMessage('userAlreadyExists') };
    }
    return { kind: 'confirmationRequired', message: strings.auth.errors.confirmationRequired };
  } catch (error) {
    // A transport failure thrown instead of returned. The error itself is dropped: its
    // message can quote the request.
    const kind = classifyAuthError(error);
    return { kind, message: authErrorMessage(kind) };
  }
}

// Sign-in and sign-up share one screen body: an email field and a password field, as in the
// designs (1a·2 and 1a·3). Only the copy, the password rule and the call differ.
export function CredentialsForm({ mode }: Props) {
  const router = useRouter();
  const isSignUp = mode === 'signUp';
  const copy = isSignUp ? strings.auth.signUp : strings.auth.signIn;
  const inFlight = useRef(false);
  const passwordInput = useRef<TextInput>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; kind: string } | null>(null);

  const { control, handleSubmit } = useForm<CredentialsFormValues>({
    resolver: zodResolver(isSignUp ? SignUpFormSchema : SignInFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const switchMode = () => router.replace(isSignUp ? '/sign-in' : '/sign-up');

  const submit = handleSubmit(async ({ email, password }) => {
    // A second tap before the first request answers must not send a second request.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    const result = await submitCredentials(mode, email, password);
    inFlight.current = false;
    setPending(false);
    if (result) setFailure(result);
  });

  return (
    <Screen
      scroll
      header={
        <View style={styles.header}>
          <BackButton label={strings.common.back} onPress={goBack} />
        </View>
      }
    >
      <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
      <Text style={styles.title}>{copy.title}</Text>

      <View style={styles.firstField}>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label={strings.auth.emailLabel}
              placeholder={strings.auth.emailPlaceholder}
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                if (failure) setFailure(null);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message ?? null}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordInput.current?.focus()}
              editable={!pending}
            />
          )}
        />
      </View>

      <View style={styles.nextField}>
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <TextField
              inputRef={passwordInput}
              label={strings.auth.passwordLabel}
              placeholder={copy.passwordPlaceholder}
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                if (failure) setFailure(null);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message ?? failure?.message ?? null}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              editable={!pending}
            />
          )}
        />
      </View>

      {isSignUp ? (
        <Text style={styles.hint}>{strings.auth.signUp.hint}</Text>
      ) : (
        // Password recovery is out of scope: drawn as in the design, does nothing.
        <TextLink label={strings.auth.signIn.forgotPassword} onPress={noop} />
      )}

      {failure?.kind === 'userAlreadyExists' ? (
        <TextLink label={strings.auth.goToSignIn} onPress={switchMode} />
      ) : null}

      <View style={styles.bottom}>
        <PrimaryButton label={copy.submit} loading={pending} onPress={() => void submit()} />
        <PromptLink prompt={copy.switchPrompt} action={copy.switchAction} onPress={switchMode} />
      </View>
    </Screen>
  );
}

function noop(): void {
  // Intentionally empty.
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  eyebrow: {
    color: colors.accent,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
  },
  title: { color: colors.text, fontSize: typeSizes.title, marginTop: spacing.md },
  firstField: { marginTop: spacing.xl },
  nextField: { marginTop: spacing.md },
  hint: { color: colors.muted, fontSize: typeSizes.caption, marginTop: spacing.md },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl, gap: spacing.sm },
});
