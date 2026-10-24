import { auth } from 'void/client/react';
import icon from './assets/icon.webp';
import SignInButton from './SignInButton.tsx';

const cliCommands = [
  {
    command: 'codiff',
    description: 'Open the current Git repository in Codiff.',
  },
  {
    command: 'codiff main',
    description: 'Review the current branch against main.',
  },
  {
    command: 'codiff pr 75',
    description: 'Open GitHub pull request 75 using the current repository.',
  },
  {
    command: 'codiff --plan plan.md --share',
    description: 'Share a Markdown plan.',
  },
];

export default function HomeGuide() {
  const { data: session, isPending } = auth.useSession();

  return (
    <main className="codiff-web-page codiff-web-guide">
      <div className="codiff-web-guide-hero">
        <section className="codiff-web-guide-intro">
          <img alt="" className="codiff-web-hero-icon" draggable={false} src={icon} />
          <h1>Codiff</h1>
          <p>Effective code reviews locally and on the web</p>
          <div className="codiff-web-guide-cta">
            {!isPending && !session?.user ? (
              <SignInButton size="lg" variant="default">
                Continue with GitHub
              </SignInButton>
            ) : null}
          </div>
        </section>
      </div>

      <section className="codiff-web-guide-section">
        <div className="codiff-web-step">1</div>
        <div className="codiff-web-guide-content">
          <h2>Install Codiff</h2>
          <pre className="codiff-web-command">
            <code>brew install --cask nkzw-tech/tap/codiff</code>
          </pre>
        </div>
      </section>

      <section className="codiff-web-guide-section">
        <div className="codiff-web-step">2</div>
        <div className="codiff-web-guide-content">
          <h2>Install the terminal helper</h2>
          <p>
            Open Codiff and choose <code>Codiff &gt; Install Terminal Helper</code> to make the{' '}
            <code>codiff</code> command available in your shell.
          </p>
        </div>
      </section>

      <section className="codiff-web-guide-section">
        <div className="codiff-web-step">3</div>
        <div className="codiff-web-guide-content">
          <h2>Review your changes</h2>
          <p>
            Run <code>codiff</code> from your repository to review changes, add comments, and commit
            selected files.
          </p>
        </div>
      </section>

      <section className="codiff-web-cli">
        <div className="codiff-web-guide-content">
          <h2>Command line</h2>
          <p>Run these commands from within a Git repository.</p>
          <div className="codiff-web-command-list">
            {cliCommands.map(({ command, description }) => (
              <article className="codiff-web-command-item" key={command}>
                <code>{command}</code>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
