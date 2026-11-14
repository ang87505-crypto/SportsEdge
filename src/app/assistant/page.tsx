import {Suspense} from 'react';
import {PageHeading,Panel,Skeleton} from '@/components/ui';
import {CommandInsights} from '@/components/command-insights';
import {AssistantChat,AskButton} from '@/components/assistant-chat';
import {NATIVE_EXAMPLES} from '@/lib/command/native-intent';

export const metadata={title:'Ask SportsEdge',description:'Ask about sports, stocks, independent Kalshi weather research and automation.'};

export default function AskPage(){
 return <>
  <PageHeading title="Ask SportsEdge" description="Ask about sports picks, stock PAPER accounts, independent Kalshi weather research, and automation. All answers use recorded evidence. Sign in for private account details."/>
  <AssistantChat/>
  <Panel title="Questions our own AI recognizes" description="A versioned offline catalog of more than 50 tested example questions. No paid language model is required; actual answers still depend on available recorded evidence.">
   <details>
    <summary>Browse examples by topic</summary>
    {(['briefing','sports','stocks','research','ops'] as const).map(topic=><section key={topic} aria-label={topic+' question examples'}>
     <h3>{topic==='ops'?'Automation and health':topic==='briefing'?'Overview':topic==='stocks'?'Stock PAPER (owner sign-in may be required)':topic==='research'?'Research and learning':'NBA props and virtual results'}</h3>
     <div className="chat-chips" role="group" aria-label={topic+' supported questions'}>
      {NATIVE_EXAMPLES.filter(x=>x.topic===topic).map(x=><AskButton key={x.q} question={x.q} className="chat-chip">{x.q}</AskButton>)}
     </div>
    </section>)}
   </details>
   <p className="quiet small-print">These examples choose read-only SportsEdge tools. They do not guarantee that an unavailable source has data, and none of them initiate orders or create bets. Unknown questions fall back to the existing domain assistant.</p>
  </Panel>
  <Suspense fallback={<Panel title="Recorded experiments and alerts"><Skeleton lines={3}/></Panel>}><CommandInsights/></Suspense>
 </>;
}
