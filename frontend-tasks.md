All the below tasks should be implemented, thoroughly tested,
and every user story requires live E2E testing to ensure it works.

You should review Engineering Soul, follow conventions.
Spec Driven Development, TDD, planning with files and files as memories.
Use plan files to track your progress, maintian todo list inside the file.

Make sure everything is well though of, thoroughly tested.

Write all notes, you want the human user to read
(whether it's final result reports, encountered issues that you cannot resolve, 
or anything that you feel you need to report to your leader), 
to "frontend-to-human.md".

Files as memories, and they should be incrementally updated, 
don't wait until end to update them.

The whole working process, for each issue is:

1. Read this file. Read the corresponding issue, think deep and think hard,
try your best to understand what the user means. Take notes if necessary.
Explore and dive into code, to get enough context to understand what's the 
issue and what we should do with it.

2. Review Engineering Soul. Think over your design and solution on the issue,
inspect and explore into code again, to see whether your decision is good enough,
and think over it for three rounds to polish and refine the details.

3. Follow spec driven development, TDD, planning with files and files as memories.
Write your plan first, use your plan to track progress. Then write failing tests,
then implement, and make things work again. Remember, we have several layers of
testing, like unit test, integration test and live E2E testing, and all the issues
should pass strict all layers of testing, and the behaviours should be enforced by
adding more testing cases into the codebase.

4. After tests are green, review and refine the code. Make it work, then make it 
work elegant and concisely and fast. Review Engineering Soul, review carefully
on the implementation and testing, and check: is everything consistent, unified
and concise and elegant? Is UI/UX good? Are user stories working smoothly? Any 
details we are missing? Are edge cases properly handled? Do refactor if necessary, 
and add tests if necessary, and ensure everything still works after your inspection and optimization.

5. Review the whole round, self reflection, take notes for future you. 

6. Proceed to next task.

Now given tasks as followed:

0. Notification is not working properly. We want that: if user subscribed to
Room 1, when the user in Room 1, new incoming messages in Room 1 does not notify.
When user not in Room 1(or the tab is not focused, for example when user switch
to some background or so), each new incoming message gets a notification, with
some brief message description and the sender. Please think deep and hard, make
our notification system mature and robust and concise and elegant. Have strong
handling for multiple messages notification too.

1. Readonly rooms should properly forbid user input, and show something like
"sending message is not allowed in this room" for users. 
You could inspect into how Rocket Chat official web client handles this.

2. We are still lacking some features. For example, the "notification settings". 
I think in BetterChat we only have "subscribe" semantics. When user subscribe to
a Room, when new message comes in, the user would receive a Browser Notification
for that. And that's it. The UI/UX should be supported for this turn on/off notify, 
maybe on the top bar, in the middle of info icon and favorite icon. 
Ensure consistency, keyboard interactions, animations, etc, should work smoothly.

3. Currently we don't have a "right click panel" for the left sidebar, 
but I'm a bit hesitated on whether we really need it. 
Please inspect into this, think deep as a product manager, a designer, 
and a UX professor, write your answer in the notes you will hand off to me.  

4. Currently we have href link support in main timeline, however we don't have a 
hover animation, which makes the visual feedback a bit weak. We could add that.

5. Mention has some bug. Currently it does not show all the members of a Room, rather it only shows those who has sent messages in that Room, which is absurd. Please inspect deep into this and fix it. I think backend should already have direct support for it, right? If not, write ntoes.

6. Animations should have an option to be disabled in a whole. This is a significant glboal option, and you may need to inspect deep and hard into this. Remember: the reason why user disable animation is usually that, they want to wipe out all motions, possibly because they are remote controlling some machine and that animation would feel quite laggy. But regardless of why, we should support this, in one toggle in one click turn everything off, and in one click turn everything on. That's a significant one, so please thoroughly test things out.

7. Currently the "scroll to load history message" does not feel quite smooth. Please inspect into this deeply, and I think some sort of prefetch could be optimized. What's more, we should be careful about the RAM usage, generally I would suggest keeping only a range of messages near the view point, and that range should be larger than what users can see, so they always feel smooth when scrolling. Rapid scrolling would result in loading inevitably, but we could optimize it to make it feel fluent and smooth, avoid excessive layout shift, etc.

8. Performance matters a lot. We want the whole experience to be smooth, fluent and efficient and effective. Inspect deep and hard, and find any potential performance issue, ranking by significance, and ensure correctness, optimize performance. Note that: don't just review or imagine performance issue, run profiles, benchmarks to prove them, test them, analyze them and optimize them. 
