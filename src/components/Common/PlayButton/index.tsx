import ButtonWithDropdown from '@app/components/Common/ButtonWithDropdown';
import { useRouter } from 'next/router';

interface PlayButtonProps {
  links: PlayButtonLink[];
}

export interface PlayButtonLink {
  text: string;
  url: string;
  svg: React.ReactNode;
}

const PlayButton = ({ links }: PlayButtonProps) => {
  const router = useRouter();

  if (!links || !links.length) {
    return null;
  }

  const isLocal = (url: string) => url.startsWith('/');

  return (
    <ButtonWithDropdown
      as="a"
      buttonType="ghost"
      text={
        <>
          {links[0].svg}
          <span>{links[0].text}</span>
        </>
      }
      href={links[0].url}
      {...(isLocal(links[0].url)
        ? {
            onClick: (e: any) => {
              e.preventDefault();
              router.push(links[0].url);
            },
          }
        : {
            target: '_blank',
            rel: 'noreferrer',
          })}
    >
      {links.length > 1 &&
        links.slice(1).map((link, i) => {
          return (
            <ButtonWithDropdown.Item
              key={`play-button-dropdown-item-${i}`}
              buttonType="ghost"
              href={link.url}
              {...(isLocal(link.url)
                ? {
                    onClick: (e: any) => {
                      e.preventDefault();
                      router.push(link.url);
                    },
                  }
                : {
                    target: '_blank',
                    rel: 'noreferrer',
                  })}
            >
              {link.svg}
              <span>{link.text}</span>
            </ButtonWithDropdown.Item>
          );
        })}
    </ButtonWithDropdown>
  );
};

export default PlayButton;
