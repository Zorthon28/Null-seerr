import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import CopyButton from '@app/components/Settings/CopyButton';
import SettingsBadge from '@app/components/Settings/SettingsBadge';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownOnSquareIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import type { NetworkSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsNetwork', {
  toastSettingsSuccess: 'Settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  network: 'Network',
  networksettings: 'Network Settings',
  networksettingsDescription:
    'Configure network settings for your Seerr instance.',
  csrfProtection: 'Enable CSRF Protection',
  csrfProtectionTip: 'Set external API access to read-only (requires HTTPS)',
  csrfProtectionHoverTip:
    'Do NOT enable this setting unless you understand what you are doing!',
  trustProxy: 'Enable Proxy Support',
  trustProxyTip:
    'Allow Seerr to correctly register client IP addresses behind a proxy',
  proxyEnabled: 'HTTP(S) Proxy',
  proxyEnabledTip:
    'Send ALL outgoing HTTP/HTTPS requests through a proxy server (host/port). Does NOT enable HTTPS, SSL, or certificate configuration.',
  proxyHostname: 'Proxy Hostname',
  proxyPort: 'Proxy Port',
  proxySsl: 'Use SSL For Proxy',
  proxyUser: 'Proxy Username',
  proxyPassword: 'Proxy Password',
  proxyBypassFilter: 'Proxy Ignored Addresses',
  proxyBypassFilterTip:
    "Use ',' as a separator, and '*.' as a wildcard for subdomains",
  proxyBypassLocalAddresses: 'Bypass Proxy for Local Addresses',
  validationDnsCacheMinTtl: 'You must provide a valid minimum TTL',
  validationDnsCacheMaxTtl: 'You must provide a valid maximum TTL',
  validationProxyPort: 'You must provide a valid port',
  networkDisclaimer:
    'Network parameters from your container/system should be used instead of these settings. See the {docs} for more information.',
  docs: 'documentation',
  forceIpv4First: 'Force IPv4 Resolution First',
  forceIpv4FirstTip:
    'Force Seerr to resolve IPv4 addresses first instead of IPv6',
  dnsCache: 'DNS Cache',
  dnsCacheTip:
    'Enable caching of DNS lookups to optimize performance and avoid making unnecessary API calls',
  dnsCacheHoverTip:
    'Do NOT enable this if you are experiencing issues with DNS lookups',
  dnsCacheForceMinTtl: 'DNS Cache Minimum TTL',
  dnsCacheForceMaxTtl: 'DNS Cache Maximum TTL',
  apiRequestTimeout: 'API Request Timeout',
  apiRequestTimeoutTip:
    'Maximum time (in seconds) to wait for responses from external services like Radarr/Sonarr. Set to 0 for no timeout.',
  validationApiRequestTimeout: 'You must provide a valid timeout value',
  cloudflareSectionTitle: 'Cloudflare Custom Domain & Tunnel',
  cloudflareSectionDescription:
    'Securely access Null-seerr from your own custom domain using Cloudflare Tunnel (cloudflared) with automatic HTTPS and no router port forwarding.',
  cloudflareDomain: 'Custom Domain / Hostname',
  cloudflareDomainTip: 'e.g. seerr.yourdomain.com or yourdomain.com',
  cloudflareTunnelToken: 'Cloudflare Zero Trust Tunnel Token (Optional)',
  cloudflareTunnelTokenTip:
    'Paste your Zero Trust tunnel connector token to automate service installation on the host.',
  cloudflareStatus: 'Tunnel Status',
  cloudflareConnected: 'Tunnel Active & Running',
  cloudflareInstalled: 'cloudflared Installed (Service Inactive)',
  cloudflareNotInstalled: 'Not Installed',
  cloudflareInstallButton: 'Save & Connect Domain',
  cloudflareCliCommand: 'PowerShell Setup Command',
  cloudflareCliCommandTip:
    'Run this command in PowerShell to launch the guided interactive Cloudflare CLI wizard or automate tunnel creation.',
  cloudflareCopiedCli: 'Copied PowerShell setup command to clipboard!',
  cloudflareDomainSaved: 'Cloudflare domain configuration saved successfully!',
  cloudflareMappedUrls: 'Automatically Configured Service URLs',
});

interface CloudflareStatusResponse {
  installed: boolean;
  serviceRunning: boolean;
  domain: string;
  subdomain?: string;
  enabled: boolean;
  tunnelTokenConfigured: boolean;
  applicationUrl: string;
}

const SettingsNetwork = () => {
  const { addToast } = useToasts();
  const intl = useIntl();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<NetworkSettings>('/api/v1/settings/network');

  const { data: cfStatus, mutate: revalidateCfStatus } =
    useSWR<CloudflareStatusResponse>(
      '/api/v1/settings/network/cloudflare/status'
    );
  const [cfDomain, setCfDomain] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [isSubmittingCf, setIsSubmittingCf] = useState(false);

  useEffect(() => {
    if (cfStatus?.domain && !cfDomain) {
      setCfDomain(cfStatus.domain);
    }
  }, [cfStatus?.domain, cfDomain]);

  const handleSaveCloudflare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfDomain) {
      return;
    }
    setIsSubmittingCf(true);
    try {
      await axios.post('/api/v1/settings/network/cloudflare/install', {
        domain: cfDomain,
        tunnelToken: cfToken,
      });
      addToast(intl.formatMessage(messages.cloudflareDomainSaved), {
        appearance: 'success',
        autoDismiss: true,
      });
      revalidateCfStatus();
      mutate('/api/v1/settings/public');
    } catch {
      addToast(intl.formatMessage(messages.toastSettingsFailure), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSubmittingCf(false);
    }
  };

  const getCleanApexDomain = (input: string): string => {
    let raw = (input || '').trim().toLowerCase();
    if (raw.startsWith('https://')) {
      raw = raw.slice(8);
    } else if (raw.startsWith('http://')) {
      raw = raw.slice(7);
    }
    if (raw.startsWith('www.')) {
      raw = raw.slice(4);
    }
    const slashIdx = raw.indexOf('/');
    if (slashIdx !== -1) {
      raw = raw.slice(0, slashIdx);
    }
    const colonIdx = raw.indexOf(':');
    if (colonIdx !== -1) {
      raw = raw.slice(0, colonIdx);
    }
    const sanitized = raw.replace(/[^a-z0-9.-]/g, '');
    const parts = sanitized.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : sanitized;
  };

  const cleanApex = getCleanApexDomain(cfDomain || cfStatus?.domain || '');
  const isValidApexDomain =
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleanApex) &&
    cleanApex.includes('.') &&
    !cleanApex.startsWith('.') &&
    !cleanApex.endsWith('.');

  const cliSetupCommand = `powershell -ExecutionPolicy Bypass -File .\\scripts\\setup_cloudflare_tunnel.ps1 -Domain ${
    cleanApex || 'nullraccoon.com'
  }${cfToken ? ` -Token "${cfToken}"` : ''}`;

  const NetworkSettingsSchema = Yup.object().shape({
    dnsCacheForceMinTtl: Yup.number().when('dnsCacheEnabled', {
      is: true,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationDnsCacheMinTtl))
          .required(intl.formatMessage(messages.validationDnsCacheMinTtl))
          .min(0),
      otherwise: (schema) => schema.nullable(),
    }),
    dnsCacheForceMaxTtl: Yup.number().when('dnsCacheEnabled', {
      is: true,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationDnsCacheMaxTtl))
          .required(intl.formatMessage(messages.validationDnsCacheMaxTtl))
          .min(-1),
      otherwise: (schema) => schema.nullable(),
    }),
    proxyPort: Yup.number().when('proxyEnabled', {
      is: (proxyEnabled: boolean) => proxyEnabled,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationProxyPort))
          .integer(intl.formatMessage(messages.validationProxyPort))
          .min(1, intl.formatMessage(messages.validationProxyPort))
          .max(65535, intl.formatMessage(messages.validationProxyPort))
          .required(intl.formatMessage(messages.validationProxyPort)),
      otherwise: (schema) => schema.nullable(),
    }),
    apiRequestTimeout: Yup.number()
      .typeError(intl.formatMessage(messages.validationApiRequestTimeout))
      .required(intl.formatMessage(messages.validationApiRequestTimeout))
      .min(0, intl.formatMessage(messages.validationApiRequestTimeout)),
  });

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.network),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.networksettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.networksettingsDescription)}
        </p>
      </div>
      <div className="section">
        <Formik
          initialValues={{
            csrfProtection: data?.csrfProtection,
            forceIpv4First: data?.forceIpv4First,
            dnsCacheEnabled: data?.dnsCache.enabled,
            dnsCacheForceMinTtl: data?.dnsCache.forceMinTtl,
            dnsCacheForceMaxTtl: data?.dnsCache.forceMaxTtl,
            trustProxy: data?.trustProxy,
            proxyEnabled: data?.proxy?.enabled,
            proxyHostname: data?.proxy?.hostname,
            proxyPort: data?.proxy?.port,
            proxySsl: data?.proxy?.useSsl,
            proxyUser: data?.proxy?.user,
            proxyPassword: data?.proxy?.password,
            proxyBypassFilter: data?.proxy?.bypassFilter,
            proxyBypassLocalAddresses: data?.proxy?.bypassLocalAddresses,
            apiRequestTimeout:
              data?.apiRequestTimeout !== undefined
                ? data.apiRequestTimeout / 1000
                : 10,
          }}
          enableReinitialize
          validationSchema={NetworkSettingsSchema}
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/network', {
                csrfProtection: values.csrfProtection,
                forceIpv4First: values.forceIpv4First,
                trustProxy: values.trustProxy,
                dnsCache: {
                  enabled: values.dnsCacheEnabled,
                  forceMinTtl: Number(values.dnsCacheForceMinTtl),
                  forceMaxTtl: Number(values.dnsCacheForceMaxTtl),
                },
                proxy: {
                  enabled: values.proxyEnabled,
                  hostname: values.proxyHostname,
                  port: Number(values.proxyPort),
                  useSsl: values.proxySsl,
                  user: values.proxyUser,
                  password: values.proxyPassword,
                  bypassFilter: values.proxyBypassFilter,
                  bypassLocalAddresses: values.proxyBypassLocalAddresses,
                },
                apiRequestTimeout: Number(values.apiRequestTimeout) * 1000,
              });
              mutate('/api/v1/settings/public');
              mutate('/api/v1/status');

              addToast(intl.formatMessage(messages.toastSettingsSuccess), {
                autoDismiss: true,
                appearance: 'success',
              });
            } catch {
              addToast(intl.formatMessage(messages.toastSettingsFailure), {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              revalidate();
            }
          }}
        >
          {({
            errors,
            touched,
            isSubmitting,
            isValid,
            values,
            setFieldValue,
          }) => {
            return (
              <Form className="section" data-testid="settings-network-form">
                <div className="form-row">
                  <label htmlFor="trustProxy" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.trustProxy)}
                    </span>
                    <SettingsBadge badgeType="restartRequired" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.trustProxyTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="trustProxy"
                      name="trustProxy"
                      onChange={() => {
                        setFieldValue('trustProxy', !values.trustProxy);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="csrfProtection" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.csrfProtection)}
                    </span>
                    <SettingsBadge badgeType="advanced" className="mr-2" />
                    <SettingsBadge badgeType="restartRequired" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.csrfProtectionTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Tooltip
                      content={intl.formatMessage(
                        messages.csrfProtectionHoverTip
                      )}
                    >
                      <Field
                        type="checkbox"
                        id="csrfProtection"
                        name="csrfProtection"
                        onChange={() => {
                          setFieldValue(
                            'csrfProtection',
                            !values.csrfProtection
                          );
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="forceIpv4First" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.forceIpv4First)}
                    </span>
                    <SettingsBadge badgeType="advanced" className="mr-2" />
                    <SettingsBadge badgeType="restartRequired" />
                    <SettingsBadge badgeType="experimental" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.forceIpv4FirstTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="forceIpv4First"
                      name="forceIpv4First"
                      onChange={() => {
                        setFieldValue('forceIpv4First', !values.forceIpv4First);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="dnsCacheEnabled" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.dnsCache)}
                    </span>
                    <SettingsBadge badgeType="advanced" className="mr-2" />
                    <SettingsBadge badgeType="restartRequired" />
                    <SettingsBadge badgeType="experimental" className="mr-2" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.dnsCacheTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Tooltip
                      content={intl.formatMessage(messages.dnsCacheHoverTip)}
                    >
                      <Field
                        type="checkbox"
                        id="dnsCacheEnabled"
                        name="dnsCacheEnabled"
                        onChange={() => {
                          setFieldValue(
                            'dnsCacheEnabled',
                            !values.dnsCacheEnabled
                          );
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
                {values.dnsCacheEnabled && (
                  <>
                    <div className="ml-4 mr-2">
                      <div className="form-row">
                        <label
                          htmlFor="dnsCacheForceMinTtl"
                          className="text-label"
                        >
                          {intl.formatMessage(messages.dnsCacheForceMinTtl)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="dnsCacheForceMinTtl"
                            name="dnsCacheForceMinTtl"
                            type="text"
                            inputMode="numeric"
                            className="short"
                          />
                        </div>
                        {errors.dnsCacheForceMinTtl &&
                          touched.dnsCacheForceMinTtl &&
                          typeof errors.dnsCacheForceMinTtl === 'string' && (
                            <div className="error">
                              {errors.dnsCacheForceMinTtl}
                            </div>
                          )}
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="dnsCacheForceMaxTtl"
                          className="text-label"
                        >
                          {intl.formatMessage(messages.dnsCacheForceMaxTtl)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="dnsCacheForceMaxTtl"
                            name="dnsCacheForceMaxTtl"
                            type="text"
                            inputMode="text"
                            className="short"
                          />
                        </div>
                        {errors.dnsCacheForceMaxTtl &&
                          touched.dnsCacheForceMaxTtl &&
                          typeof errors.dnsCacheForceMaxTtl === 'string' && (
                            <div className="error">
                              {errors.dnsCacheForceMaxTtl}
                            </div>
                          )}
                      </div>
                    </div>
                  </>
                )}
                <div className="form-row">
                  <label htmlFor="apiRequestTimeout" className="text-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.apiRequestTimeout)}
                    </span>
                    <SettingsBadge badgeType="restartRequired" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.apiRequestTimeoutTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      id="apiRequestTimeout"
                      name="apiRequestTimeout"
                      type="text"
                      inputMode="numeric"
                      className="short"
                    />
                  </div>
                  {errors.apiRequestTimeout &&
                    touched.apiRequestTimeout &&
                    typeof errors.apiRequestTimeout === 'string' && (
                      <div className="error">{errors.apiRequestTimeout}</div>
                    )}
                </div>
                <div className="form-row">
                  <label htmlFor="proxyEnabled" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.proxyEnabled)}
                    </span>
                    <SettingsBadge badgeType="advanced" className="mr-2" />
                    <SettingsBadge badgeType="restartRequired" />
                    <span className="label-tip">
                      {intl.formatMessage(messages.proxyEnabledTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="proxyEnabled"
                      name="proxyEnabled"
                      onChange={() => {
                        setFieldValue('proxyEnabled', !values.proxyEnabled);
                      }}
                    />
                  </div>
                </div>
                {values.proxyEnabled && (
                  <>
                    <div className="ml-4 mr-2">
                      <div className="form-row">
                        <label
                          htmlFor="proxyHostname"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyHostname)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyHostname"
                              name="proxyHostname"
                              type="text"
                            />
                          </div>
                          {errors.proxyHostname &&
                            touched.proxyHostname &&
                            typeof errors.proxyHostname === 'string' && (
                              <div className="error">
                                {errors.proxyHostname}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxyPort" className="checkbox-label">
                          {intl.formatMessage(messages.proxyPort)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="proxyPort"
                            name="proxyPort"
                            type="text"
                            inputMode="numeric"
                            className="short"
                          />
                          {errors.proxyPort &&
                            touched.proxyPort &&
                            typeof errors.proxyPort === 'string' && (
                              <div className="error">{errors.proxyPort}</div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxySsl" className="checkbox-label">
                          {intl.formatMessage(messages.proxySsl)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            type="checkbox"
                            id="proxySsl"
                            name="proxySsl"
                            onChange={() => {
                              setFieldValue('proxySsl', !values.proxySsl);
                            }}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxyUser" className="checkbox-label">
                          {intl.formatMessage(messages.proxyUser)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyUser"
                              name="proxyUser"
                              type="text"
                            />
                          </div>
                          {errors.proxyUser &&
                            touched.proxyUser &&
                            typeof errors.proxyUser === 'string' && (
                              <div className="error">{errors.proxyUser}</div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyPassword"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyPassword)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyPassword"
                              name="proxyPassword"
                              type="password"
                            />
                          </div>
                          {errors.proxyPassword &&
                            touched.proxyPassword &&
                            typeof errors.proxyPassword === 'string' && (
                              <div className="error">
                                {errors.proxyPassword}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyBypassFilter"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyBypassFilter)}
                          <span className="label-tip">
                            {intl.formatMessage(messages.proxyBypassFilterTip)}
                          </span>
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyBypassFilter"
                              name="proxyBypassFilter"
                              type="text"
                            />
                          </div>
                          {errors.proxyBypassFilter &&
                            touched.proxyBypassFilter &&
                            typeof errors.proxyBypassFilter === 'string' && (
                              <div className="error">
                                {errors.proxyBypassFilter}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyBypassLocalAddresses"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(
                            messages.proxyBypassLocalAddresses
                          )}
                        </label>
                        <div className="form-input-area">
                          <Field
                            type="checkbox"
                            id="proxyBypassLocalAddresses"
                            name="proxyBypassLocalAddresses"
                            onChange={() => {
                              setFieldValue(
                                'proxyBypassLocalAddresses',
                                !values.proxyBypassLocalAddresses
                              );
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div className="actions">
                  <div className="flex justify-end">
                    <span className="ml-3 inline-flex rounded-md shadow-sm">
                      <Button
                        buttonType="primary"
                        type="submit"
                        disabled={isSubmitting || !isValid}
                      >
                        <ArrowDownOnSquareIcon />
                        <span>
                          {isSubmitting
                            ? intl.formatMessage(globalMessages.saving)
                            : intl.formatMessage(globalMessages.save)}
                        </span>
                      </Button>
                    </span>
                  </div>
                </div>
              </Form>
            );
          }}
        </Formik>
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.cloudflareSectionTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.cloudflareSectionDescription)}
        </p>
      </div>
      <div className="section">
        <form onSubmit={handleSaveCloudflare}>
          <div className="form-row">
            <span className="text-label">
              {intl.formatMessage(messages.cloudflareStatus)}
            </span>
            <div className="form-input-area">
              <div className="flex items-center space-x-3">
                {cfStatus?.serviceRunning ? (
                  <Badge badgeType="success">
                    {intl.formatMessage(messages.cloudflareConnected)}
                  </Badge>
                ) : cfStatus?.installed ? (
                  <Badge badgeType="warning">
                    {intl.formatMessage(messages.cloudflareInstalled)}
                  </Badge>
                ) : (
                  <Badge badgeType="default">
                    {intl.formatMessage(messages.cloudflareNotInstalled)}
                  </Badge>
                )}
                {cfStatus?.domain && (
                  <a
                    href={`https://${cfStatus.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <span>{`https://${cfStatus.domain}`}</span>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4 ml-1" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="cfDomain" className="text-label">
              {intl.formatMessage(messages.cloudflareDomain)}
              <span className="label-tip">
                {intl.formatMessage(messages.cloudflareDomainTip)}
              </span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <input
                  id="cfDomain"
                  type="text"
                  placeholder="e.g. https://www.nullraccoon.com/ or nullraccoon.com"
                  value={cfDomain}
                  onChange={(e) => setCfDomain(e.target.value)}
                />
              </div>
            </div>
          </div>

          {isValidApexDomain && (
            <div className="form-row">
              <span className="text-label">
                {intl.formatMessage(messages.cloudflareMappedUrls)}
              </span>
              <div className="form-input-area">
                <div className="rounded-md bg-gray-800 p-3 text-xs space-y-1.5 text-gray-300 border border-gray-700">
                  {[
                    { name: 'Null-seerr', sub: 'nullseerr' },
                    { name: 'Jellyfin', sub: 'jellyfin' },
                    { name: 'Radarr', sub: 'radarr' },
                    { name: 'Sonarr', sub: 'sonarr' },
                    { name: 'qBittorrent', sub: 'qbittorrent' },
                    { name: 'Prowlarr', sub: 'prowlarr' },
                  ].map((service, idx, arr) => {
                    const safeHost = `${encodeURIComponent(service.sub)}.${encodeURIComponent(cleanApex)}`;
                    const safeUrl = `https://${safeHost}`;
                    const isLast = idx === arr.length - 1;

                    return (
                      <div
                        key={service.sub}
                        className={`flex justify-between py-0.5 ${
                          !isLast ? 'border-b border-gray-700' : ''
                        }`}
                      >
                        <span className="font-semibold text-white">
                          {service.name}
                        </span>
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:underline"
                        >
                          {safeUrl}
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="form-row">
            <label htmlFor="cfToken" className="text-label">
              {intl.formatMessage(messages.cloudflareTunnelToken)}
              <span className="label-tip">
                {intl.formatMessage(messages.cloudflareTunnelTokenTip)}
              </span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <input
                  id="cfToken"
                  type="password"
                  placeholder="eyJh..."
                  value={cfToken}
                  onChange={(e) => setCfToken(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="cfCliCommand" className="text-label">
              {intl.formatMessage(messages.cloudflareCliCommand)}
              <span className="label-tip">
                {intl.formatMessage(messages.cloudflareCliCommandTip)}
              </span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <input
                  id="cfCliCommand"
                  type="text"
                  readOnly
                  value={cliSetupCommand}
                  className="rounded-l-only"
                />
                <CopyButton
                  textToCopy={cliSetupCommand}
                  toastMessage={intl.formatMessage(
                    messages.cloudflareCopiedCli
                  )}
                />
              </div>
            </div>
          </div>

          <div className="actions">
            <div className="flex justify-end">
              <span className="ml-3 inline-flex rounded-md shadow-sm">
                <Button
                  buttonType="primary"
                  type="submit"
                  disabled={isSubmittingCf || !cfDomain}
                >
                  <ArrowDownOnSquareIcon />
                  <span>
                    {isSubmittingCf
                      ? intl.formatMessage(globalMessages.saving)
                      : intl.formatMessage(messages.cloudflareInstallButton)}
                  </span>
                </Button>
              </span>
            </div>
          </div>
        </form>
      </div>
    </>
  );
};

export default SettingsNetwork;
