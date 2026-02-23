/* =================================================================
   Dickinson Group Lab Website — JavaScript
   ================================================================= */

document.addEventListener('DOMContentLoaded', () => {

    // --- Navbar scroll effect ---
    const navbar = document.getElementById('navbar');
    const handleScroll = () => {
        navbar.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // --- Mobile nav toggle ---
    const navToggle = document.getElementById('nav-toggle');
    const navLinks = document.getElementById('nav-links');

    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('open');
        navToggle.classList.toggle('active');
    });

    // Close mobile nav on link click
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('open');
            navToggle.classList.remove('active');
        });
    });

    // --- Active nav link on scroll ---
    const sections = document.querySelectorAll('section[id]');
    const navItems = document.querySelectorAll('.nav-links a');

    const updateActiveNav = () => {
        const scrollPos = window.scrollY + 200;
        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            if (scrollPos >= top && scrollPos < top + height) {
                navItems.forEach(item => {
                    item.classList.toggle('active', item.getAttribute('href') === `#${id}`);
                });
            }
        });
    };
    window.addEventListener('scroll', updateActiveNav, { passive: true });

    // --- Animated number counters ---
    const counters = document.querySelectorAll('.stat-number[data-target]');
    let countersAnimated = false;

    const animateCounters = () => {
        if (countersAnimated) return;

        const heroStats = document.querySelector('.hero-stats');
        if (!heroStats) return;

        const rect = heroStats.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.bottom < 0) return;

        countersAnimated = true;

        counters.forEach(counter => {
            const target = parseInt(counter.dataset.target);
            const duration = 2000;
            const start = performance.now();

            const step = (now) => {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                const current = Math.round(eased * target);

                if (target >= 1000) {
                    counter.textContent = current.toLocaleString();
                } else {
                    counter.textContent = current;
                }

                if (progress < 1) {
                    requestAnimationFrame(step);
                }
            };

            requestAnimationFrame(step);
        });
    };

    window.addEventListener('scroll', animateCounters, { passive: true });
    animateCounters(); // Check on load

    // --- Scroll reveal (fade-in) ---
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Add fade-in class to elements — stagger siblings within each group
    const animateGroups = [
        { selector: '.section-header', stagger: 0 },
        { selector: '.research-card', stagger: 0.12 },
        { selector: '.extra-card', stagger: 0.1 },
        { selector: '.team-card', stagger: 0.08 },
        { selector: '.outreach-card', stagger: 0.12 },
        { selector: '.pi-image-placeholder', stagger: 0 },
        { selector: '.pi-content', stagger: 0 },
        { selector: '.contact-info', stagger: 0 },
        { selector: '.contact-map', stagger: 0 },
        { selector: '.group-photo-wrapper', stagger: 0 },
        { selector: '.hero-stats', stagger: 0 },
        { selector: '.research-cta', stagger: 0 },
        { selector: '.featured-pub-card', stagger: 0.1 },
    ];

    animateGroups.forEach(({ selector, stagger }) => {
        const els = document.querySelectorAll(selector);
        els.forEach((el, i) => {
            el.classList.add('fade-in');
            if (stagger > 0) el.style.transitionDelay = `${(i % 4) * stagger}s`;
            revealObserver.observe(el);
        });
    });

    // --- Floating particles in hero ---
    const particlesContainer = document.getElementById('particles');
    if (particlesContainer) {
        const particleCount = 40;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            const size = Math.random() * 3 + 1;
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const duration = Math.random() * 20 + 15;
            const delay = Math.random() * 10;
            const opacity = Math.random() * 0.15 + 0.08;

            Object.assign(particle.style, {
                position: 'absolute',
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: '50%',
                background: `rgba(128, 0, 0, ${opacity})`,
                left: `${x}%`,
                top: `${y}%`,
                animation: `float ${duration}s ${delay}s ease-in-out infinite`,
                pointerEvents: 'none'
            });

            particlesContainer.appendChild(particle);
        }

        // Add keyframes for floating
        const style = document.createElement('style');
        style.textContent = `
            @keyframes float {
                0%, 100% { transform: translate(0, 0) scale(1); }
                25% { transform: translate(${Math.random() * 60 - 30}px, ${Math.random() * 60 - 30}px) scale(1.1); }
                50% { transform: translate(${Math.random() * 60 - 30}px, ${Math.random() * 60 - 30}px) scale(0.9); }
                75% { transform: translate(${Math.random() * 60 - 30}px, ${Math.random() * 60 - 30}px) scale(1.05); }
            }
        `;
        document.head.appendChild(style);
    }

    // --- Publication filter (year + topic modes) ---
    const pubList = document.getElementById('pub-list');
    const yearFilters = document.getElementById('year-filters');
    const topicFilters = document.getElementById('topic-filters');
    const modeBtns = document.querySelectorAll('.pub-mode-btn');

    if (pubList && yearFilters) {
        // Filter by year
        function filterByYear(filter) {
            const articles = pubList.querySelectorAll('.pub-item');
            articles.forEach(article => {
                const yearEl = article.querySelector('.pub-year');
                if (!yearEl) return;
                const year = parseInt(yearEl.textContent);

                if (filter === 'all') {
                    article.style.display = '';
                } else if (filter === 'older') {
                    article.style.display = year <= 2018 ? '' : 'none';
                } else {
                    article.style.display = year === parseInt(filter) ? '' : 'none';
                }
            });
        }

        // Filter by topic
        function filterByTopic(topic) {
            const articles = pubList.querySelectorAll('.pub-item');
            articles.forEach(article => {
                if (topic === 'all') {
                    article.style.display = '';
                } else {
                    const topics = (article.dataset.topics || '').split(',').map(t => t.trim());
                    article.style.display = topics.includes(topic) ? '' : 'none';
                }
            });
        }

        // Attach click handlers to filter buttons within a container
        function setupFilterButtons(container, filterFn, useDataAttr) {
            const btns = container.querySelectorAll('.pub-filter-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', () => {
                    btns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const value = useDataAttr ? btn.dataset.topic : btn.dataset.filter;
                    filterFn(value);
                });
            });
        }

        // Setup year filter buttons
        setupFilterButtons(yearFilters, filterByYear, false);

        // Setup topic filter buttons
        if (topicFilters) {
            setupFilterButtons(topicFilters, filterByTopic, true);
        }

        // Mode toggle: switch between year and topic filter bars
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const mode = btn.dataset.mode;
                if (mode === 'year') {
                    yearFilters.style.display = '';
                    if (topicFilters) topicFilters.style.display = 'none';
                    // Reset to "All" in year mode
                    const allBtn = yearFilters.querySelector('[data-filter="all"]');
                    if (allBtn) allBtn.click();
                } else if (mode === 'topic') {
                    yearFilters.style.display = 'none';
                    if (topicFilters) topicFilters.style.display = '';
                    // Reset to "All" in topic mode
                    const allBtn = topicFilters ? topicFilters.querySelector('[data-topic="all"]') : null;
                    if (allBtn) allBtn.click();
                }
            });
        });

        // Auto-trigger the active filter on page load (default: year mode, 2026)
        const activeYearBtn = yearFilters.querySelector('.pub-filter-btn.active');
        if (activeYearBtn) activeYearBtn.click();
    }

    // --- Smooth scroll for nav links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                const offset = 80;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });

    // --- Bluesky news feed ---
    const newsFeed = document.getElementById('news-feed');
    if (newsFeed) {
        const BSKY_ACTOR = 'chembiobryan.bsky.social';
        const BSKY_LIMIT = 6;

        async function loadBlueskyFeed() {
            try {
                const res = await fetch(
                    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${BSKY_ACTOR}&limit=${BSKY_LIMIT}&filter=posts_no_replies`
                );
                if (!res.ok) throw new Error('Failed to fetch');
                const data = await res.json();

                const posts = data.feed || [];
                if (posts.length === 0) {
                    newsFeed.innerHTML = '<div class="news-error">No posts found.</div>';
                    return;
                }

                newsFeed.innerHTML = posts.map(item => {
                    const post = item.post;
                    const record = post.record;
                    const author = post.author;
                    const text = record.text || '';
                    const createdAt = new Date(record.createdAt);
                    const dateStr = createdAt.toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                    });

                    // Check for embedded images
                    let imageHtml = '';
                    if (post.embed && post.embed.images && post.embed.images.length > 0) {
                        const img = post.embed.images[0];
                        imageHtml = `<img class="news-image" src="${img.thumb}" alt="${img.alt || ''}" loading="lazy">`;
                    }

                    const postUri = post.uri.replace('at://', '').replace('app.bsky.feed.post/', '');
                    const [did, , rkey] = post.uri.replace('at://', '').split('/');
                    const postUrl = `https://bsky.app/profile/${author.handle}/post/${rkey}`;

                    return `
                        <a class="news-card" href="${postUrl}" target="_blank" rel="noopener">
                            <div class="news-card-header">
                                ${author.avatar ? `<img class="news-avatar" src="${author.avatar}" alt="">` : ''}
                                <div>
                                    <div class="news-author">${author.displayName || author.handle}</div>
                                    <div class="news-handle">@${author.handle}</div>
                                </div>
                                <div class="news-date">${dateStr}</div>
                            </div>
                            <div class="news-text">${escapeHtml(text)}</div>
                            ${imageHtml}
                            <span class="news-view-link">View on Bluesky &rarr;</span>
                        </a>
                    `;
                }).join('');

                // Add news cards to scroll-reveal
                newsFeed.querySelectorAll('.news-card').forEach((card, i) => {
                    card.classList.add('fade-in');
                    card.style.transitionDelay = `${i * 0.1}s`;
                    revealObserver.observe(card);
                });

            } catch (err) {
                newsFeed.innerHTML = '<div class="news-error">Unable to load posts. <a href="https://bsky.app/profile/chembiobryan.bsky.social" target="_blank" rel="noopener">Visit our Bluesky profile &rarr;</a></div>';
            }
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        loadBlueskyFeed();
    }

    // --- Alumni section toggle ---
    const alumniToggle = document.getElementById('alumni-toggle');
    const alumniContent = document.getElementById('alumni-content');
    if (alumniToggle && alumniContent) {
        alumniToggle.addEventListener('click', () => {
            const expanded = alumniToggle.getAttribute('aria-expanded') === 'true';
            alumniToggle.setAttribute('aria-expanded', !expanded);
            if (expanded) {
                alumniContent.style.display = 'none';
            } else {
                alumniContent.style.display = 'block';
            }
        });
    }

});
