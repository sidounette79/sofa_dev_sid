import { Trans, useLingui } from "@lingui/react/macro";
import { IconEye, IconEyeOff, IconKey } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { SofaLogo } from "@/components/sofa-logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, signIn, signUp } from "@/lib/auth/client";
import { useAppForm } from "@/lib/form";
import { queryClient } from "@/lib/orpc/client";

export interface AuthConfig {
  oidcEnabled: boolean;
  oidcProviderName: string | null;
  passwordLoginDisabled: boolean;
  registrationOpen?: boolean;
}

const authInputClass =
  "h-11 rounded-lg border-border/50 bg-background/50 px-4 py-0 placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-ring md:text-sm";

const fieldVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 },
  },
};

export function AuthForm({
  mode,
  authConfig,
}: {
  mode: "login" | "register";
  authConfig?: AuthConfig;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [oidcLoading, setOidcLoading] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);

  const isRegister = mode === "register";
  const showOidc = authConfig?.oidcEnabled ?? false;
  const showPasswordForm = !(authConfig?.passwordLoginDisabled ?? false);
  const oidcProviderName = authConfig?.oidcProviderName || "SSO";

  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        if (isRegister) {
          const result = await signUp.email({
            name: value.name,
            email: value.email,
            password: value.password,
          });
          if (result.error) {
            setError(result.error.message ?? t`Registration failed`);
            return;
          }
        } else {
          const result = await signIn.email({ email: value.email, password: value.password });
          if (result.error) {
            setError(result.error.message ?? t`Login failed`);
            return;
          }
        }
        // 09.10, Sid: logging in as a different account without a hard
        // reload left the previous account's library/tracking data cached
        // under the same query keys (the server scopes by session cookie,
        // not by any userId in the key) — the sister saw Sid's watchlist
        // and in-progress shows after switching accounts. Never caught
        // before since Sid was the only one actually switching accounts.
        queryClient.clear();
        if (isRegister) {
          void navigate({ to: "/onboarding" });
        } else {
          void navigate({ to: "/library", search: { type: "tv" } });
        }
      } catch {
        setError(t`Something went wrong`);
      }
    },
  });

  async function handleOidcLogin() {
    setError("");
    setOidcLoading(true);
    try {
      await authClient.signIn.oauth2({
        providerId: "oidc",
        callbackURL: "/library?type=tv",
      });
    } catch {
      setError(t`Failed to start SSO login`);
    } finally {
      setOidcLoading(false);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Subtle glow behind card */}
      <div className="bg-primary/3 absolute -inset-4 rounded-2xl blur-2xl" />

      <motion.div
        className="border-border/50 bg-card/80 relative space-y-8 rounded-xl border p-8 backdrop-blur-sm"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring" as const, stiffness: 200, damping: 20 }}
      >
        <div className="space-y-2 text-center">
          <Link to="/" className="text-primary inline-flex justify-center">
            <SofaLogo className="size-9" />
          </Link>
          <h1 className="text-lg font-medium text-balance">
            {isRegister ? <Trans>Create your account</Trans> : <Trans>Welcome back</Trans>}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isRegister ? (
              <Trans>Start tracking your watches</Trans>
            ) : (
              <Trans>Sign in to continue</Trans>
            )}
          </p>
        </div>

        {showOidc && (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08 } },
            }}
          >
            <motion.div variants={fieldVariants}>
              <Button
                type="button"
                variant="outline"
                onClick={handleOidcLogin}
                disabled={oidcLoading}
                className="border-border/50 bg-background/50 hover:bg-accent hover:text-foreground h-11 w-full gap-2 rounded-lg text-sm"
              >
                <IconKey aria-hidden={true} className="size-4" />
                {oidcLoading ? (
                  <Trans>Redirecting…</Trans>
                ) : (
                  <Trans>Sign in with {oidcProviderName}</Trans>
                )}
              </Button>
            </motion.div>
          </motion.div>
        )}

        {showOidc && showPasswordForm && (
          <div className="flex items-center gap-3">
            <div className="bg-border/50 h-px flex-1" />
            <span className="text-muted-foreground text-xs">
              <Trans>or</Trans>
            </span>
            <div className="bg-border/50 h-px flex-1" />
          </div>
        )}

        {showPasswordForm && (
          <motion.form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08 } },
            }}
          >
            {isRegister && (
              <form.Field name="name">
                {(field) => (
                  <motion.div variants={fieldVariants} className="space-y-1.5">
                    <Label
                      htmlFor="name"
                      className="text-muted-foreground tracking-wider uppercase"
                    >
                      <Trans>Name</Trans>
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      required
                      autoComplete="name"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className={authInputClass}
                      placeholder={t`Your name…`}
                    />
                  </motion.div>
                )}
              </form.Field>
            )}

            <form.Field name="email">
              {(field) => (
                <motion.div variants={fieldVariants} className="space-y-1.5">
                  <Label htmlFor="email" className="text-muted-foreground tracking-wider uppercase">
                    <Trans>Email</Trans>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    spellCheck={false}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className={authInputClass}
                    placeholder="wwhite@graymatter.biz"
                  />
                </motion.div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <motion.div variants={fieldVariants} className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="text-muted-foreground tracking-wider uppercase"
                  >
                    <Trans>Password</Trans>
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={revealPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className={`${authInputClass} pr-10`}
                      placeholder={t`Min 8 characters…`}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealPassword((prev) => !prev)}
                      className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-3 flex items-center"
                      aria-label={revealPassword ? t`Hide password` : t`Show password`}
                    >
                      {revealPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </button>
                  </div>
                </motion.div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <motion.div variants={fieldVariants}>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="hover:shadow-primary/20 h-11 w-full rounded-lg text-sm hover:shadow-lg"
                  >
                    {isSubmitting ? (
                      <Trans>Loading…</Trans>
                    ) : isRegister ? (
                      <Trans>Create account</Trans>
                    ) : (
                      <Trans>Sign in</Trans>
                    )}
                  </Button>
                </motion.div>
              )}
            </form.Subscribe>
          </motion.form>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <Alert variant="destructive" className="bg-destructive/10">
                <AlertDescription className="text-destructive text-sm">{error}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        {showPasswordForm && (isRegister || authConfig?.registrationOpen !== false) && (
          <p className="text-muted-foreground text-center text-sm">
            {isRegister ? (
              <>
                <Trans>Already have an account?</Trans>{" "}
                <Link
                  to="/login"
                  className="text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <Trans>Sign in</Trans>
                </Link>
              </>
            ) : (
              <>
                <Trans>Don&apos;t have an account?</Trans>{" "}
                <Link
                  to="/register"
                  className="text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <Trans>Register</Trans>
                </Link>
              </>
            )}
          </p>
        )}
      </motion.div>
    </div>
  );
}
